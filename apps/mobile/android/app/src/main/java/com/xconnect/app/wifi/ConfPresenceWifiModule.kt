package com.xconnect.app.wifi

import android.content.Context
import android.net.wifi.WifiManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.uimanager.ViewManager

class ConfPresenceWifiModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val wifiManager: WifiManager? by lazy {
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    }

    private var lastScanTriggerTime = 0L
    private val MIN_SCAN_INTERVAL_MS = 30_000L // 30 seconds to respect Android 9+ scan throttling

    override fun getName() = "ConfPresenceWifi"

    @ReactMethod
    fun getWifiFingerprint(promise: Promise) {
        try {
            val wm = wifiManager
            if (wm == null || !wm.isWifiEnabled) {
                // Wi-Fi hardware unavailable or turned off
                promise.resolve(Arguments.createArray())
                return
            }

            val now = System.currentTimeMillis()
            if (now - lastScanTriggerTime >= MIN_SCAN_INTERVAL_MS) {
                lastScanTriggerTime = now
                try {
                    @Suppress("DEPRECATION")
                    wm.startScan()
                } catch (_: Exception) {
                    // Ignore startScan throttling / deprecation exceptions
                }
            }

            @Suppress("DEPRECATION")
            val results = wm.scanResults ?: emptyList()

            val array: WritableArray = Arguments.createArray()
            results
                .filter { !it.BSSID.isNullOrEmpty() }
                .sortedByDescending { it.level }
                .take(15)
                .forEach { scanResult ->
                    val map = Arguments.createMap().apply {
                        putString("bssid", scanResult.BSSID)
                        putString("ssid", scanResult.SSID ?: "")
                        putInt("rssi", scanResult.level)
                        putInt("frequency", scanResult.frequency)
                    }
                    array.pushMap(map)
                }

            promise.resolve(array)
        } catch (e: SecurityException) {
            // Permissions not granted yet -> resolve empty array gracefully
            promise.resolve(Arguments.createArray())
        } catch (e: Exception) {
            promise.resolve(Arguments.createArray())
        }
    }
}

class ConfPresenceWifiPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(ConfPresenceWifiModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
