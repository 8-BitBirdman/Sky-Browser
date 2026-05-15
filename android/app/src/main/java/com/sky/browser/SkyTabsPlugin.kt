package com.sky.browser

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "SkyTabs")
class SkyTabsPlugin : Plugin() {

    private val webViews = HashMap<String, WebView>()

    override fun load() {
        AdBlocker.initialize(context)
        // Enable WebView remote debugging in debug builds (chrome://inspect).
        try {
            val ai = context.applicationInfo
            if ((ai.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                WebView.setWebContentsDebuggingEnabled(true)
            }
        } catch (_: Exception) {}
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebViewOnUi(id: String, url: String): WebView {
        // MUST be called on UI thread.
        val ctx = activity
        val wv = WebView(ctx)
        wv.settings.javaScriptEnabled = true
        wv.settings.domStorageEnabled = true
        wv.settings.useWideViewPort = true
        wv.settings.loadWithOverviewMode = true
        wv.settings.setSupportMultipleWindows(false)
        wv.settings.javaScriptCanOpenWindowsAutomatically = false
        wv.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, req: WebResourceRequest?): WebResourceResponse? {
                return req?.let { AdBlocker.intercept(it) }
            }
            override fun onPageStarted(view: WebView?, u: String?, favicon: Bitmap?) {
                u?.let { notify("tab:$id:navigate", JSObject().put("url", it)) }
                emitCanGo(id, view)
            }
            override fun doUpdateVisitedHistory(view: WebView?, u: String?, isReload: Boolean) {
                u?.let { notify("tab:$id:navigate", JSObject().put("url", it)) }
                emitCanGo(id, view)
            }
        }
        wv.webChromeClient = object : WebChromeClient() {
            override fun onReceivedTitle(view: WebView?, title: String?) {
                title?.let { notify("tab:$id:title", JSObject().put("title", it)) }
            }
        }
        wv.visibility = WebView.GONE
        // Sibling of Capacitor bridge WebView; only fills rect set via setRect.
        val bridgeView = bridge.webView
        val parent = (bridgeView.parent as? ViewGroup) ?: (ctx.window.decorView as ViewGroup)
        parent.addView(wv, ViewGroup.LayoutParams(0, 0))
        // Defer first navigation until blocklist parsed so first load is protected.
        AdBlocker.onReady {
            ctx.runOnUiThread { wv.loadUrl(url) }
        }
        return wv
    }

    private fun notify(name: String, data: JSObject) {
        notifyListeners(name, data)
    }

    private fun emitCanGo(id: String, view: WebView?) {
        val v = view ?: return
        notify("tab:$id:cangostate", JSObject()
            .put("back", v.canGoBack())
            .put("forward", v.canGoForward()))
    }

    @PluginMethod
    fun create(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val url = call.getString("url") ?: "about:blank"
        activity.runOnUiThread {
            if (!webViews.containsKey(id)) webViews[id] = createWebViewOnUi(id, url)
            call.resolve()
        }
    }

    @PluginMethod
    fun load(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val url = call.getString("url") ?: return call.reject("url required")
        AdBlocker.onReady {
            activity.runOnUiThread { webViews[id]?.loadUrl(url); call.resolve() }
        }
    }

    @PluginMethod fun reload(call: PluginCall) = onWv(call) { it.reload() }
    @PluginMethod fun back(call: PluginCall) = onWv(call) { if (it.canGoBack()) it.goBack() }
    @PluginMethod fun forward(call: PluginCall) = onWv(call) { if (it.canGoForward()) it.goForward() }

    @PluginMethod
    fun setRect(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val x = call.getDouble("x") ?: 0.0
        val y = call.getDouble("y") ?: 0.0
        val w = call.getDouble("w") ?: 0.0
        val h = call.getDouble("h") ?: 0.0
        activity.runOnUiThread {
            webViews[id]?.let { wv ->
                val bridgeView = bridge.webView
                // JS rect is in CSS px relative to bridge WebView viewport, scaled by DPR on the JS side.
                wv.x = bridgeView.x + x.toFloat()
                wv.y = bridgeView.y + y.toFloat()
                val lp = wv.layoutParams ?: ViewGroup.LayoutParams(w.toInt(), h.toInt())
                lp.width = w.toInt()
                lp.height = h.toInt()
                wv.layoutParams = lp
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun setVisible(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val v = call.getBoolean("visible") ?: false
        activity.runOnUiThread {
            webViews[id]?.visibility = if (v) WebView.VISIBLE else WebView.GONE
            call.resolve()
        }
    }

    @PluginMethod
    fun destroy(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        activity.runOnUiThread {
            webViews.remove(id)?.let { wv ->
                (wv.parent as? ViewGroup)?.removeView(wv)
                wv.destroy()
            }
            call.resolve()
        }
    }

    private fun onWv(call: PluginCall, op: (WebView) -> Unit) {
        val id = call.getString("id") ?: return call.reject("id required")
        activity.runOnUiThread { webViews[id]?.let(op); call.resolve() }
    }

    /** Called by MainActivity on hardware back press (UI thread).
     *  Returns true if a visible WebView consumed the event. */
    fun handleBackPressed(): Boolean {
        val visible = webViews.values.firstOrNull { it.visibility == WebView.VISIBLE } ?: return false
        if (!visible.canGoBack()) return false
        visible.goBack()
        return true
    }

    override fun handleOnPause() {
        super.handleOnPause()
        activity.runOnUiThread { webViews.values.forEach { it.onPause() } }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        activity.runOnUiThread { webViews.values.forEach { it.onResume() } }
    }

    override fun handleOnDestroy() {
        activity.runOnUiThread {
            webViews.values.forEach { wv ->
                (wv.parent as? ViewGroup)?.removeView(wv)
                wv.destroy()
            }
            webViews.clear()
        }
        super.handleOnDestroy()
    }
}
