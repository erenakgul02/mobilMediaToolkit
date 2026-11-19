import com.alierenakgul.mobilmediatoolkit.nativemodules.MediaFileIdentity
import java.io.File
import kotlin.io.path.createTempDirectory

fun main() {
    val temp = createTempDirectory("media-publication-test").toFile()
    try {
        val pending = File(temp, ".pending-1795713085-Galiba_720p.mp4").apply { writeText("video data") }
        val finalFile = File(temp, "Galiba_720p.mp4")
        var path = pending.absolutePath
        val saved = MediaFileIdentity.finishPublication(pending.length(), {
            check(pending.renameTo(finalFile))
            path = finalFile.absolutePath
            true
        }, { path })
        check(saved == finalFile && saved.readText() == "video data")
        check(MediaFileIdentity.publishedName(pending.name) == finalFile.name)
        check(MediaFileIdentity.publishedName("song-pending-123.m4a") == "song-pending-123.m4a")
        check(MediaFileIdentity.publishedName(".pending-bad-song.mp4") == ".pending-bad-song.mp4")
        check(runCatching { MediaFileIdentity.finishPublication(10, { false }, { error("Must not read before publication") }) }.exceptionOrNull() is java.io.IOException)
        check(runCatching { MediaFileIdentity.finishPublication(999, { true }, { path }) }.isFailure)
        val stillPending = File(temp, ".pending-123-unfinished.mp4").apply { writeText("x") }
        check(runCatching { MediaFileIdentity.finishPublication(1, { true }, { stillPending.path }) }.isFailure)
        check(MediaFileIdentity.selectedIndex(listOf(1, 3, 4), 3) == 1)
        check(MediaFileIdentity.selectedIndex(listOf(2, 4), 2) == 0)
        check(runCatching { MediaFileIdentity.selectedIndex(listOf(1, 3, 4), 0) }.isFailure)
        check(runCatching { MediaFileIdentity.selectedIndex(emptyList(), 0) }.isFailure)
        println("PASS: publication rename, validation, legacy names, selection remapping and missing selection")
    } finally { temp.deleteRecursively() }
}
