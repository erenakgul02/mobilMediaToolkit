package com.alierenakgul.mobilmediatoolkit.nativemodules

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.IOException
import java.security.MessageDigest

/** Completed media always lives in shared storage, never an uninstallable app directory. */
object SharedMediaStorage {
    fun directory(): File = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "MediaToolkit")

    fun digest(file: File): ByteArray {
        val hash = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(65536)
            while (true) { val count = input.read(buffer); if (count < 0) break; hash.update(buffer, 0, count) }
        }
        return hash.digest()
    }

    fun mime(file: File): String = when (file.extension.lowercase()) {
        "mp4", "m4v" -> "video/mp4"
        "webm" -> "video/webm"
        "m4a", "mp4a" -> "audio/mp4"
        "mp3" -> "audio/mpeg"
        "aac" -> "audio/aac"
        "ogg", "opus" -> "audio/ogg"
        else -> "application/octet-stream"
    }

    @Synchronized
    fun publish(context: Context, source: File, requestedName: String = source.name, reuseContent: Boolean = false): File {
        require(source.isFile && source.length() > 0) { "Kaydedilecek dosya boş" }
        val name = requestedName.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").take(220)
        require(name.isNotBlank() && name != "." && name != "..") { "Geçersiz dosya adı" }
        val candidate = File(directory(), name)
        if (candidate.canonicalPath == source.canonicalPath) return source
        if (candidate.isFile && candidate.canRead() && candidate.length() == source.length()) {
            if (runCatching { digest(candidate).contentEquals(digest(source)) }.getOrDefault(false)) return candidate
        }
        if (reuseContent) {
            val sourceHash by lazy { digest(source) }
            for (existing in runCatching { directory().listFiles() }.getOrNull().orEmpty()) {
                if (existing.isFile && existing.canRead() && existing.length() == source.length() &&
                    runCatching { digest(existing).contentEquals(sourceHash) }.getOrDefault(false)) return existing
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime(File(name)))
                put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/MediaToolkit/")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IOException("Ortak indirme klasörü oluşturulamadı")
            try {
                resolver.openOutputStream(uri, "w")?.use { output -> source.inputStream().use { it.copyTo(output) } }
                    ?: throw IOException("Ortak indirme klasörüne yazılamadı")
                val path = resolver.query(uri, arrayOf(MediaStore.MediaColumns.DATA), null, null, null)?.use {
                    if (it.moveToFirst()) it.getString(0) else null
                } ?: throw IOException("Kaydedilen dosyanın yolu alınamadı")
                val saved = File(path)
                if (!saved.canRead() || saved.length() != source.length()) throw IOException("Dosya kaydı doğrulanamadı")
                if (resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null) != 1)
                    throw IOException("Dosya ortak depolamada yayımlanamadı")
                return saved
            } catch (error: Exception) {
                runCatching { resolver.delete(uri, null, null) }
                throw error
            }
        }
        val dir = directory()
        if (!dir.isDirectory && !dir.mkdirs()) throw IOException("İndirilenler klasörüne erişim izni gerekiyor")
        var target = candidate
        var suffix = 1
        while (target.exists()) target = File(dir, "${candidate.nameWithoutExtension}_${suffix++}.${candidate.extension}")
        val temporary = File.createTempFile(".media-", ".part", dir)
        try {
            source.copyTo(temporary, overwrite = true)
            if (!temporary.renameTo(target)) throw IOException("Dosya kaydedilemedi")
            MediaScannerConnection.scanFile(context, arrayOf(target.absolutePath), arrayOf(mime(target)), null)
            return target
        } finally { temporary.delete() }
    }
}
