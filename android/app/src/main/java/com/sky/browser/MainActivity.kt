package com.sky.browser

import android.os.Bundle
import androidx.activity.OnBackPressedCallback
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    private lateinit var backCallback: OnBackPressedCallback

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(SkyTabsPlugin::class.java)
        super.onCreate(savedInstanceState)

        // AndroidX OnBackPressedDispatcher — works on Android 16+ predictive back.
        backCallback = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val plugin = bridge.getPlugin("SkyTabs")?.instance as? SkyTabsPlugin
                if (plugin?.handleBackPressed() == true) return
                // Disable our callback then ask dispatcher again so the next callback
                // (Capacitor bridge / system finish) handles it.
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
                // Re-enable on next UI loop, after current dispatch finished.
                window.decorView.post { isEnabled = true }
            }
        }
        onBackPressedDispatcher.addCallback(this, backCallback)
    }
}
