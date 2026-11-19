package com.alierenakgul.mobilmediatoolkit.nativemodules

object MediaFileIdentity {
    fun finishPublication(expectedSize: Long, publish: () -> Boolean, readPath: () -> String?): java.io.File {
        if (!publish()) throw java.io.IOException("Dosya ortak depolamada yayımlanamadı")
        val path = readPath() ?: throw java.io.IOException("Kaydedilen dosyanın yolu alınamadı")
        val saved = java.io.File(path)
        if (saved.name.startsWith(".pending-") || !saved.isFile || !saved.canRead() || saved.length() != expectedSize)
            throw java.io.IOException("Dosya kaydı doğrulanamadı")
        return saved
    }

    private val pending = Regex("^\\.pending-[0-9]+-(.+)$")
    fun publishedName(name: String): String = pending.matchEntire(name)?.groupValues?.get(1) ?: name
    fun selectedIndex(sourceIndices: List<Int>, requestedIndex: Int): Int {
        val index = sourceIndices.indexOf(requestedIndex)
        require(index >= 0) { "Seçilen şarkının dosyası bulunamadı. Klasörü tarayarak arşivi yenileyin." }
        return index
    }
}
