import os
import sys

try:
    if sys.stdout.encoding != 'utf-8':
        sys.stdout.reconfigure(encoding='utf-8')
    if sys.stderr.encoding != 'utf-8':
        sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

import uuid
import threading
import time
import json
import socket
import io
import qrcode
import subprocess
import re
from datetime import datetime
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
import yt_dlp
import imageio_ffmpeg

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.join(BASE_DIR, "downloads")
METADATA_FILE = os.path.join(DOWNLOAD_DIR, "history.json")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# Find ffmpeg binary
FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()

# In-memory download tasks tracker
# task_id -> { id, url, title, thumbnail, type, quality, status, progress, speed, eta, filename, filesize, error, createdAt }
tasks = {}

PUBLIC_URL = None
cloudflared_proc = None

def start_tunnel_thread():
    global PUBLIC_URL, cloudflared_proc
    cloudflared_bin = os.path.join(BASE_DIR, "cloudflared.exe")
    if not os.path.exists(cloudflared_bin):
        return

    try:
        cloudflared_proc = subprocess.Popen(
            [cloudflared_bin, "tunnel", "--url", "http://localhost:5000"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        while True:
            line = cloudflared_proc.stdout.readline()
            if not line:
                break
            m = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
            if m:
                PUBLIC_URL = m.group(0)
                print("\n=======================================================")
                print(f">> [CANLI CLOUDFLARE HTTPS LINK]: {PUBLIC_URL}")
                print(f">> Telefondan ve Safari'den aninda acabilirsiniz!")
                print("=======================================================\n")
                break
    except Exception as e:
        print(f"Tunnel thread error: {e}")

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def load_history():
    if os.path.exists(METADATA_FILE):
        try:
            with open(METADATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_to_history(item):
    history = load_history()
    # Filter out if already exists
    history = [h for h in history if h.get("filename") != item.get("filename")]
    history.insert(0, item)
    # Keep last 50
    history = history[:50]
    try:
        with open(METADATA_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving history: {e}")

def format_bytes(size):
    if not size:
        return "0 B"
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024.0:
            return f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} TB"

def format_duration(seconds):
    if not seconds:
        return "00:00"
    seconds = int(seconds)
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"

@app.route("/api/health", methods=["GET"])
def health():
    ip = get_local_ip()
    port = 5000
    lan_url = f"http://{ip}:{port}"
    active_mobile_url = PUBLIC_URL or lan_url
    return jsonify({
        "status": "online",
        "ffmpeg": bool(FFMPEG_PATH and os.path.exists(FFMPEG_PATH)),
        "ffmpeg_path": FFMPEG_PATH,
        "local_ip": ip,
        "mobile_url": active_mobile_url,
        "public_url": PUBLIC_URL,
        "qr_url": f"/api/qr",
        "timestamp": datetime.now().isoformat()
    })

@app.route("/api/qr", methods=["GET"])
def get_qr():
    target = request.args.get("url")
    if not target or target == "undefined":
        target = PUBLIC_URL or f"http://{get_local_ip()}:5000"
    
    img = qrcode.make(target)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")

import urllib.parse

def is_valid_media_url(url):
    """Validate that the URL is a safe, valid HTTP/HTTPS link to prevent SSRF and injection."""
    if not url or not isinstance(url, str) or len(url) > 2048:
        return False
    try:
        parsed = urllib.parse.urlparse(url.strip())
        if parsed.scheme not in ("http", "https"):
            return False
        if not parsed.netloc:
            return False
        # Block internal / loopback addresses to prevent SSRF
        netloc = parsed.netloc.lower().split(":")[0]
        blocked_hosts = ("localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254")
        if netloc in blocked_hosts or netloc.startswith("192.168.") or netloc.startswith("10."):
            return False
        return True
    except Exception:
        return False

@app.route("/api/info", methods=["POST"])
def get_video_info():
    data = request.get_json() or {}
    url = data.get("url", "").strip()

    if not is_valid_media_url(url):
        return jsonify({"error": "Lütfen geçerli ve güvenli bir YouTube / medya bağlantısı girin."}), 400

    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'extract_flat': False,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            # Extract video qualities
            available_resolutions = set()
            if 'formats' in info:
                for f in info['formats']:
                    height = f.get('height')
                    if height and f.get('vcodec') != 'none':
                        if height in [360, 480, 720, 1080, 1440, 2160]:
                            available_resolutions.add(height)

            sorted_res = sorted(list(available_resolutions), reverse=True)
            if not sorted_res:
                sorted_res = [720, 480, 360]

            formats_video = [
                {"label": f"{h}p HD" if h >= 720 else f"{h}p", "value": str(h), "ext": "mp4"}
                for h in sorted_res
            ]

            formats_audio = [
                {"label": "MP3 Yüksek Kalite (320 kbps)", "value": "320", "ext": "mp3"},
                {"label": "MP3 Standart Kalite (192 kbps)", "value": "192", "ext": "mp3"},
                {"label": "MP3 Düşük Boyut (128 kbps)", "value": "128", "ext": "mp3"},
                {"label": "Orijinal Ses (M4A / AAC)", "value": "best", "ext": "m4a"},
            ]

            return jsonify({
                "id": info.get("id"),
                "title": info.get("title"),
                "channel": info.get("uploader") or info.get("channel") or "Bilinmeyen Kanal",
                "duration": format_duration(info.get("duration")),
                "duration_seconds": info.get("duration"),
                "thumbnail": info.get("thumbnail"),
                "view_count": f"{info.get('view_count', 0):,}".replace(",", "."),
                "formats_video": formats_video,
                "formats_audio": formats_audio,
                "original_url": url
            })
    except Exception as e:
        print(f"Info extraction error: {e}")
        return jsonify({"error": f"Video bilgisi alınamadı: {str(e)}"}), 400

def run_download_thread(task_id, url, media_type, quality, title_hint):
    task = tasks[task_id]

    def progress_hook(d):
        if d['status'] == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            downloaded = d.get('downloaded_bytes', 0)
            percent = 0
            if total > 0:
                percent = round((downloaded / total) * 100, 1)

            speed = d.get('speed')
            speed_str = f"{format_bytes(speed)}/s" if speed else ""
            eta = d.get('eta')
            eta_str = f"{eta} sn" if eta else ""

            task.update({
                "status": "downloading",
                "progress": percent,
                "downloaded_bytes": downloaded,
                "total_bytes": total,
                "speed": speed_str,
                "eta": eta_str
            })
        elif d['status'] == 'finished':
            task.update({
                "status": "processing",
                "progress": 98,
                "speed": "Dönüştürülüyor...",
                "eta": ""
            })

    output_template = os.path.join(DOWNLOAD_DIR, f"%(title)s_{task_id[:6]}.%(ext)s")

    ydl_opts = {
        'ffmpeg_location': FFMPEG_PATH,
        'outtmpl': output_template,
        'progress_hooks': [progress_hook],
        'quiet': True,
        'no_warnings': True,
        'restrictfilenames': False,
        'windowsfilenames': True,
    }

    if media_type == 'mp3':
        ydl_opts.update({
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3' if quality != 'best' else 'm4a',
                'preferredquality': quality if quality != 'best' else '192',
            }],
        })
    else:
        # mp4 video
        res = quality if quality.isdigit() else "720"
        # Download best video matching height + best audio and merge to mp4
        ydl_opts.update({
            'format': f'bestvideo[height<={res}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={res}]+bestaudio/best[height<={res}]/best',
            'merge_output_format': 'mp4',
            'postprocessors': [{
                'key': 'FFmpegVideoConvertor',
                'preferedformat': 'mp4',
            }],
        })

    try:
        task["status"] = "downloading"
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            meta = ydl.extract_info(url, download=True)
            task["title"] = meta.get("title", title_hint)
            task["thumbnail"] = meta.get("thumbnail", task.get("thumbnail"))

        # Find final file in download dir matching task_id
        final_filename = None
        for fname in os.listdir(DOWNLOAD_DIR):
            if f"_{task_id[:6]}." in fname:
                final_filename = fname
                break

        if not final_filename:
            # Fallback search
            for fname in os.listdir(DOWNLOAD_DIR):
                if task_id[:6] in fname:
                    final_filename = fname
                    break

        if final_filename:
            filepath = os.path.join(DOWNLOAD_DIR, final_filename)
            size = os.path.getsize(filepath) if os.path.exists(filepath) else 0
            
            task.update({
                "status": "completed",
                "progress": 100,
                "filename": final_filename,
                "filesize": format_bytes(size),
                "filesize_raw": size,
                "completedAt": datetime.now().strftime("%d.%m.%Y %H:%M")
            })

            # Save to history
            save_to_history({
                "id": task_id,
                "title": task["title"],
                "filename": final_filename,
                "type": media_type,
                "quality": quality,
                "thumbnail": task.get("thumbnail"),
                "filesize": format_bytes(size),
                "date": task["completedAt"],
                "download_url": f"/api/download-direct/{final_filename}"
            })
        else:
            task.update({
                "status": "failed",
                "error": "İndirilen dosya dizinde bulunamadı."
            })

    except Exception as e:
        print(f"Download thread error: {e}")
        task.update({
            "status": "failed",
            "error": str(e)
        })

@app.route("/api/download", methods=["POST"])
def start_download():
    data = request.get_json() or {}
    url = data.get("url", "").strip()
    media_type = data.get("type", "mp3") # 'mp3' or 'mp4'
    quality = str(data.get("quality", "320"))
    title_hint = str(data.get("title", "Video"))[:200]
    thumbnail = str(data.get("thumbnail", ""))[:500]

    if not is_valid_media_url(url):
        return jsonify({"error": "Geçersiz veya güvenli olmayan bağlantı."}), 400

    if media_type not in ("mp3", "mp4"):
        media_type = "mp3"

    allowed_qualities = {"320", "192", "128", "best", "360", "480", "720", "1080", "1440", "2160"}
    if quality not in allowed_qualities:
        quality = "320" if media_type == "mp3" else "720"

    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "id": task_id,
        "url": url,
        "title": title_hint,
        "thumbnail": thumbnail,
        "type": media_type,
        "quality": quality,
        "status": "queued",
        "progress": 0,
        "speed": "",
        "eta": "",
        "filename": None,
        "filesize": "",
        "error": None,
        "createdAt": datetime.now().isoformat()
    }

    t = threading.Thread(
        target=run_download_thread,
        args=(task_id, url, media_type, quality, title_hint),
        daemon=True
    )
    t.start()

    return jsonify({"taskId": task_id, "message": "İndirme başlatıldı."})

@app.route("/api/progress/<task_id>", methods=["GET"])
def get_progress(task_id):
    task = tasks.get(task_id)
    if not task:
        return jsonify({"error": "Görev bulunamadı."}), 404
    return jsonify(task)

@app.route("/api/download-direct/<path:filename>", methods=["GET"])
def download_direct(filename):
    if ".." in filename or "/" in filename or "\\" in filename:
        return jsonify({"error": "Geçersiz dosya adı veya yetkisiz erişim."}), 400

    clean_name = os.path.basename(filename)
    safe_dir = os.path.abspath(DOWNLOAD_DIR)
    file_path = os.path.abspath(os.path.join(safe_dir, clean_name))

    if not file_path.startswith(safe_dir) or not os.path.isfile(file_path):
        return jsonify({"error": "Dosya bulunamadı veya yetkisiz erişim."}), 404

    return send_from_directory(safe_dir, clean_name, as_attachment=True)

@app.route("/api/files/<task_id>", methods=["GET"])
def download_task_file(task_id):
    task = tasks.get(task_id)
    if not task or not task.get("filename"):
        return jsonify({"error": "Dosya henüz hazır değil veya görev bulunamadı."}), 404

    clean_name = os.path.basename(task["filename"])
    safe_dir = os.path.abspath(DOWNLOAD_DIR)
    file_path = os.path.abspath(os.path.join(safe_dir, clean_name))

    if not file_path.startswith(safe_dir) or not os.path.isfile(file_path):
        return jsonify({"error": "Dosya diskte bulunamadı."}), 404

    return send_from_directory(safe_dir, clean_name, as_attachment=True)

@app.route("/api/history", methods=["GET"])
def get_history():
    history = load_history()
    # verify files still exist
    valid = []
    safe_dir = os.path.abspath(DOWNLOAD_DIR)
    for item in history:
        clean_name = os.path.basename(item.get("filename", ""))
        fpath = os.path.abspath(os.path.join(safe_dir, clean_name))
        if fpath.startswith(safe_dir) and os.path.exists(fpath):
            valid.append(item)
    return jsonify(valid)

@app.route("/api/history/<path:filename>", methods=["DELETE"])
def delete_history_item(filename):
    if ".." in filename or "/" in filename or "\\" in filename:
        return jsonify({"error": "Geçersiz dosya adı veya yetkisiz erişim engellendi."}), 400

    safe_dir = os.path.abspath(DOWNLOAD_DIR)
    clean_name = os.path.basename(filename)
    fpath = os.path.abspath(os.path.join(safe_dir, clean_name))

    if not fpath.startswith(safe_dir):
        return jsonify({"error": "Yetkisiz erişim engellendi."}), 403

    if not os.path.exists(fpath):
        return jsonify({"error": "Dosya bulunamadı."}), 404

    try:
        os.remove(fpath)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    history = load_history()
    history = [h for h in history if os.path.basename(h.get("filename", "")) != clean_name]
    try:
        with open(METADATA_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

    return jsonify({"success": True})

DIST_DIR = os.path.join(os.path.dirname(BASE_DIR), "mobile", "dist")

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path.startswith("api/"):
        return jsonify({"error": "Endpoint bulunamadı"}), 404

    safe_dist = os.path.abspath(DIST_DIR)
    target_file = os.path.abspath(os.path.join(safe_dist, path))

    # Path traversal check for static files
    if not target_file.startswith(safe_dist):
        return jsonify({"error": "Yetkisiz erişim engellendi."}), 403

    if path and os.path.exists(target_file) and os.path.isfile(target_file):
        return send_from_directory(safe_dist, path)

    index_file = os.path.join(safe_dist, "index.html")
    if os.path.exists(index_file):
        return send_file(index_file)

    return jsonify({"message": "Mobil Media Toolkit API çalışıyor."})

if __name__ == "__main__":
    ip = get_local_ip()
    port = int(os.environ.get("PORT", 5000))

    # Start Cloudflare Tunnel in background for instant public HTTPS
    t_tunnel = threading.Thread(target=start_tunnel_thread, daemon=True)
    t_tunnel.start()

    print("\n=======================================================")
    print(">> Mobil Media Toolkit Python Backend Baslatiliyor...")
    print(f">> Yerel Ag IP (Mobil): http://{ip}:{port}")
    print(f">> Laptop (Localhost):  http://127.0.0.1:{port}")
    print(f">> FFMPEG Yolu:        {FFMPEG_PATH}")
    print(">> Cloudflare Canli Baglanti hazirlaniyor...")
    print("=======================================================\n")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
