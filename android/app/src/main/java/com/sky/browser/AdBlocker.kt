package com.sky.browser

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

object AdBlocker {
    private val blocklist: AtomicReference<Set<String>> = AtomicReference(emptySet())
    private const val URL_HAGEZI = "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/domains/pro.txt"
    private val executor = Executors.newSingleThreadExecutor()
    private const val TTL_MS = 24L * 60 * 60 * 1000  // 24h

    @Volatile var ready: Boolean = false
        private set
    private val readyListeners = mutableListOf<() -> Unit>()
    private val lock = Any()
    private const val BLOCKED_HTML = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blocked</title><style>html,body{height:100%;margin:0;background:#0b0d10;color:#e6e9ef;font:15px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif}main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;gap:8px}h1{margin:0;font-size:20px;font-weight:600}p{margin:0;opacity:.7;max-width:32ch}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#1a1d22;padding:2px 6px;border-radius:4px;font-size:13px}</style></head><body><main><h1>Blocked by Sky</h1><p>This page was blocked by the ad-block list.</p></main></body></html>"""

    fun onReady(cb: () -> Unit) {
        synchronized(lock) {
            if (ready) cb() else readyListeners.add(cb)
        }
    }

    private fun markReady() {
        synchronized(lock) {
            ready = true
            readyListeners.forEach { it() }
            readyListeners.clear()
        }
    }

    fun initialize(ctx: Context) {
        val cache = File(ctx.filesDir, "blocklist.txt")
        executor.execute {
            var loadedFromCache = false
            if (cache.exists()) {
                runCatching { parse(cache.readText()); loadedFromCache = true }
            }
            val fresh = loadedFromCache && (System.currentTimeMillis() - cache.lastModified() < TTL_MS)
            if (loadedFromCache) markReady()
            if (fresh) return@execute
            try {
                val data = fetch(URL_HAGEZI)
                if (data.isNotBlank() && looksLikeBlocklist(data)) {
                    cache.writeText(data)
                    parse(data)
                }
            } catch (_: Exception) { /* keep cached */ }
            if (!loadedFromCache) markReady()
        }
    }

    private fun looksLikeBlocklist(data: String): Boolean {
        // Sanity: at least 100 non-comment lines, none of them HTML.
        if (data.contains("<html", ignoreCase = true)) return false
        var n = 0
        for (l in data.lineSequence()) {
            val t = l.trim()
            if (t.isEmpty() || t.startsWith("#")) continue
            n++
            if (n > 100) return true
        }
        return false
    }

    private fun fetch(u: String): String {
        var url = URL(u)
        var hops = 0
        while (hops < 5) {
            val conn = url.openConnection() as HttpURLConnection
            conn.setRequestProperty("User-Agent", "SkyBrowser/1.0")
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            conn.instanceFollowRedirects = false
            val code = conn.responseCode
            if (code in 300..399) {
                val loc = conn.getHeaderField("Location") ?: error("redirect w/o Location")
                conn.disconnect()
                url = URL(url, loc)
                hops++
                continue
            }
            if (code !in 200..299) {
                conn.disconnect()
                error("HTTP $code")
            }
            return conn.inputStream.bufferedReader().use { it.readText() }
        }
        error("too many redirects")
    }

    private fun parse(data: String) {
        val s = HashSet<String>(200_000)
        data.lineSequence().forEach { raw ->
            var line = raw.trim()
            if (line.isEmpty() || line.startsWith("#")) return@forEach
            // Strip hosts-file prefix (0.0.0.0 / 127.0.0.1 example.com).
            val sp = line.indexOf(' ')
            if (sp > 0 && (line.startsWith("0.0.0.0") || line.startsWith("127.0.0.1"))) {
                line = line.substring(sp + 1).trim()
            }
            if (line.isNotEmpty()) s.add(line.lowercase())
        }
        blocklist.set(s)
    }

    fun isBlocked(host: String?): Boolean {
        if (host.isNullOrEmpty()) return false
        val list = blocklist.get()
        if (list.isEmpty()) return false
        val parts = host.lowercase().split('.')
        for (i in 0 until parts.size - 1) {
            if (list.contains(parts.subList(i, parts.size).joinToString("."))) return true
        }
        return false
    }

    fun intercept(req: WebResourceRequest): WebResourceResponse? {
        val host = req.url?.host ?: return null
        if (!isBlocked(host)) return null
        return if (req.isForMainFrame) {
            WebResourceResponse("text/html", "utf-8", 200, "OK", emptyMap(),
                ByteArrayInputStream(BLOCKED_HTML.toByteArray(Charsets.UTF_8)))
        } else {
            // Fresh stream per call: WebResourceResponse may be consumed concurrently.
            WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        }
    }
}
