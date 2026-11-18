package com.alierenakgul.mobilmediatoolkit.nativemodules

import android.app.Activity
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import com.facebook.react.bridge.*
import java.io.File
import java.io.IOException
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** A user-initiated recovery scan. It never deletes the user's source files. */
class ArchiveScanner(private val context: ReactApplicationContext) : BaseActivityEventListener() {
    private val requestCode = 43021
    private val busy = AtomicBoolean(false)
    private val worker = Executors.newSingleThreadExecutor()
    private var pickerPromise: Promise? = null
    private val extensions = setOf("m4a", "mp4a", "aac", "mp3", "webm", "ogg", "opus", "mp4", "m4v")

    init { context.addActivityEventListener(this) }

    fun dispose() {
        context.removeActivityEventListener(this)
        pickerPromise?.reject("SCAN_CLOSED", "Klasör seçimi kapandı")
        pickerPromise = null
        worker.shutdown()
    }

    fun scan(chooseFolder: Boolean, promise: Promise) {
        if (!busy.compareAndSet(false, true)) { promise.reject("SCAN_BUSY", "Bir tarama zaten devam ediyor"); return }
        if (!chooseFolder) { runScan(null, promise); return }
        context.runOnUiQueueThread {
            val activity = context.currentActivity
            if (activity == null) { busy.set(false); promise.reject("NO_ACTIVITY", "Aktif ekran bulunamadı"); return@runOnUiQueueThread }
            try {
                pickerPromise = promise
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        putExtra(DocumentsContract.EXTRA_INITIAL_URI,
                            DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Download/MediaToolkit"))
                    }
                }
                activity.startActivityForResult(intent, requestCode)
            } catch (error: Exception) {
                pickerPromise = null; busy.set(false)
                promise.reject("PICKER_ERROR", "Klasör seçici açılamadı", error)
            }
        }
    }

    override fun onActivityResult(activity: Activity, code: Int, resultCode: Int, data: Intent?) {
        if (code != requestCode) return
        val promise = pickerPromise ?: return
        pickerPromise = null
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            busy.set(false)
            promise.resolve(Arguments.createMap().apply { putBoolean("cancelled", true) })
        } else runScan(uri, promise)
    }

    private fun roots(): List<File> = listOfNotNull(
        SharedMediaStorage.directory(),
        context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.let { File(it, "MediaToolkit") },
        File(context.filesDir, "MediaToolkit")
    ).distinctBy { it.absolutePath }

    private fun metadata(file: File, originalUrl: String, originalName: String): WritableMap {
        var title = file.nameWithoutExtension
        var artist = "Bilinmeyen sanatçı"
        var duration = 0L
        var isVideo = file.extension.lowercase() in setOf("mp4", "m4v", "webm")
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(file.absolutePath)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)?.takeIf { it.isNotBlank() }?.let { title = it }
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)?.takeIf { it.isNotBlank() }?.let { artist = it }
            duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            val hasVideo = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO)
            if (hasVideo != null) isVideo = hasVideo == "yes"
        } catch (_: Exception) { /* Files without tags are listed by filename. */ }
        finally { runCatching { retriever.release() } }
        return Arguments.createMap().apply {
            putString("id", "scan_${file.absolutePath.hashCode()}")
            putString("filename", file.name)
            putString("title", title)
            putString("uploader", artist)
            putString("type", if (isVideo) "mp4" else "m4a")
            putString("thumbnail", "")
            putString("filesize", String.format(Locale.US, "%.2f MB", file.length() / 1048576.0))
            putString("download_url", Uri.fromFile(file).toString())
            putString("originalDownloadUrl", originalUrl)
            putString("originalFilename", originalName)
            putDouble("modifiedAt", file.lastModified().toDouble())
            putDouble("durationMs", duration.toDouble())
        }
    }

    private fun runScan(tree: Uri?, promise: Promise) {
        worker.execute {
            try {
                val found = linkedMapOf<String, WritableMap>()
                var skipped = 0
                var migrated = 0
                var needsAccess = false
                val publicRoot = SharedMediaStorage.directory().canonicalPath
                val previouslyShared = runCatching { SharedMediaStorage.directory().listFiles() }.getOrNull().orEmpty().map { it.absolutePath }.toSet()
                fun addFile(source: File) {
                    if (source.extension.lowercase() !in extensions) return
                    if (!source.isFile || !source.canRead() || source.length() == 0L) { skipped++; return }
                    try {
                        val originalUrl = Uri.fromFile(source).toString()
                        val saved = if (source.canonicalPath.startsWith(publicRoot + File.separator)) source
                            else SharedMediaStorage.publish(context, source, reuseContent = true)
                        if (saved.canonicalPath != source.canonicalPath && saved.absolutePath !in previouslyShared) migrated++
                        // Private legacy copies may point at an already scanned shared file.
                        found[saved.canonicalPath] = metadata(saved, originalUrl, source.name)
                    } catch (_: Exception) { skipped++ }
                }
                for (root in roots()) {
                    val files = runCatching { root.listFiles() }.getOrNull()
                    if (files == null) {
                        if (root == SharedMediaStorage.directory()) needsAccess = true
                        continue
                    }
                    for (file in files) {
                        if (file.canonicalPath.startsWith(root.canonicalPath + File.separator)) addFile(file)
                    }
                }
                if (tree != null) {
                    val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
                    val columns = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE)
                    val cursor = context.contentResolver.query(children, columns, null, null, null)
                        ?: throw IOException("Seçilen klasör okunamadı")
                    cursor.use {
                        while (it.moveToNext()) {
                            val name = it.getString(1) ?: continue
                            if (it.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR || File(name).extension.lowercase() !in extensions) continue
                            val uri = DocumentsContract.buildDocumentUriUsingTree(tree, it.getString(0))
                            val staged = File.createTempFile("archive-", ".part", context.cacheDir)
                            try {
                                context.contentResolver.openInputStream(uri)?.use { input -> staged.outputStream().use { output -> input.copyTo(output) } }
                                    ?: throw IOException("Dosya okunamadı")
                                val expected = if (it.isNull(3)) -1L else it.getLong(3)
                                if (staged.length() == 0L || (expected >= 0L && staged.length() != expected)) throw IOException("Dosya eksik okundu")
                                val saved = SharedMediaStorage.publish(context, staged, name, reuseContent = true)
                                found.putIfAbsent(saved.canonicalPath, metadata(saved, uri.toString(), name))
                            } catch (_: Exception) { skipped++ }
                            finally { staged.delete() }
                        }
                    }
                    needsAccess = false
                }
                promise.resolve(Arguments.createMap().apply {
                    putArray("items", Arguments.createArray().apply { found.values.forEach { pushMap(it) } })
                    putInt("skipped", skipped)
                    putInt("migrated", migrated)
                    putBoolean("needsAccess", needsAccess)
                    putBoolean("cancelled", false)
                })
            } catch (error: Exception) {
                promise.reject("SCAN_ERROR", error.localizedMessage ?: "Klasör taranamadı", error)
            } finally { busy.set(false) }
        }
    }
}
