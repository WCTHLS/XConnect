// Copy this file into the generated Android application package and register ConfPresenceBlePackage.
// AndroidManifest permissions required:
// BLUETOOTH_SCAN, BLUETOOTH_ADVERTISE, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION (Android <= 11)
package com.xconnect.app.ble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanRecord
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.os.ParcelUuid
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.uimanager.ViewManager
import java.nio.charset.StandardCharsets
import java.util.UUID

private val SERVICE_UUID: UUID = UUID.fromString("00007a04-0000-1000-8000-00805f9b34fb")
private const val MANUFACTURER_ID = 0x7A04

class ConfPresenceBleModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val adapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private var advertising = false
    private var activeAdvertiseCallback: AdvertiseCallback? = null

    override fun getName() = "ConfPresenceBle"

    @ReactMethod
    fun startAdvertising(rotatingId: String, promise: Promise) {
        if (adapter == null) {
            promise.reject("BLE_UNAVAILABLE", "Bluetooth is unavailable on this device")
            return
        }
        if (!adapter.isEnabled) {
            promise.reject("BLUETOOTH_OFF", "Bluetooth is turned off. Please turn on Bluetooth in settings.")
            return
        }
        val advertiser = adapter.bluetoothLeAdvertiser
        if (advertiser == null) {
            promise.reject("BLE_UNAVAILABLE", "BLE advertising is unavailable on this device")
            return
        }
        val payload = rotatingId.toByteArray(StandardCharsets.UTF_8).copyOf(14)
        val data = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .addServiceData(ParcelUuid(SERVICE_UUID), payload)
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .build()
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(false)
            .build()
        activeAdvertiseCallback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                advertising = true
                promise.resolve(null)
            }
            override fun onStartFailure(errorCode: Int) {
                val msg = when (errorCode) {
                    ADVERTISE_FAILED_DATA_TOO_LARGE -> "BLE advertising data exceeds packet limit"
                    ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "Too many BLE advertisers active"
                    ADVERTISE_FAILED_ALREADY_STARTED -> "BLE advertising already started"
                    ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "BLE advertising unsupported on this hardware"
                    else -> "BLE advertising failed with code $errorCode"
                }
                promise.reject("ADVERTISE_FAILED", msg)
            }
        }
        try {
            advertiser.startAdvertising(settings, data, activeAdvertiseCallback)
        } catch (e: SecurityException) {
            promise.reject("PERMISSION_DENIED", "Nearby devices / Bluetooth permissions are required: ${e.message}")
        } catch (e: Exception) {
            promise.reject("ADVERTISE_FAILED", "Failed to start BLE advertising: ${e.message}")
        }
    }

    @ReactMethod
    fun stopAdvertising(promise: Promise) {
        try {
            activeAdvertiseCallback?.let { adapter?.bluetoothLeAdvertiser?.stopAdvertising(it) }
        } catch (e: Exception) {
            // Ignore stop errors
        }
        advertising = false
        activeAdvertiseCallback = null
        promise.resolve(null)
    }

    @ReactMethod
    fun startScanning(promise: Promise) {
        if (adapter == null) {
            promise.reject("BLE_UNAVAILABLE", "Bluetooth is unavailable on this device")
            return
        }
        if (!adapter.isEnabled) {
            promise.reject("BLUETOOTH_OFF", "Bluetooth is turned off. Please turn on Bluetooth in settings.")
            return
        }
        val scanner = adapter.bluetoothLeScanner
        if (scanner == null) { promise.reject("BLE_UNAVAILABLE", "BLE scanning is unavailable on this device"); return }
        val filters = emptyList<ScanFilter>()
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0)
            .build()
        try {
            scanner.startScan(filters, settings, scanCallback)
            promise.resolve(null)
        } catch (e: SecurityException) {
            promise.reject("PERMISSION_DENIED", "Nearby devices / Bluetooth scan permissions are required: ${e.message}")
        } catch (e: Exception) {
            promise.reject("SCAN_FAILED", "Failed to start BLE scanning: ${e.message}")
        }
    }

    @ReactMethod
    fun stopScanning(promise: Promise) {
        try {
            adapter?.bluetoothLeScanner?.stopScan(scanCallback)
        } catch (e: Exception) {
            // Ignore stop errors
        }
        promise.resolve(null)
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val token = extractToken(result.scanRecord) ?: return
            val event: WritableMap = Arguments.createMap().apply {
                putString("rotatingId", token)
                putInt("rssi", result.rssi)
                putString("seenAt", java.time.Instant.now().toString())
            }
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("ConfPresencePeerDetected", event)
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>?) {
            results?.forEach { onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, it) }
        }
    }

    private fun extractToken(record: ScanRecord?): String? {
        if (record == null) return null

        // 1. Direct Service Data by UUID
        val direct = record.getServiceData(ParcelUuid(SERVICE_UUID))
        if (direct != null && direct.isNotEmpty()) {
            val s = String(direct, StandardCharsets.UTF_8).trimEnd('\u0000').trim()
            if (s.isNotEmpty()) return s
        }

        // 2. Iterate Service Data map
        record.serviceData?.forEach { (uuid, data) ->
            if (uuid.toString().contains("7a04", ignoreCase = true) ||
                uuid.uuid.mostSignificantBits == SERVICE_UUID.mostSignificantBits) {
                val s = String(data, StandardCharsets.UTF_8).trimEnd('\u0000').trim()
                if (s.isNotEmpty()) return s
            }
        }

        // 3. Raw byte parsing fallback (Type 0x16: 16-bit Service Data)
        val raw = record.bytes ?: return null
        var i = 0
        while (i < raw.size - 1) {
            val len = raw[i].toInt() and 0xFF
            if (len == 0 || i + len >= raw.size) break
            val type = raw[i + 1].toInt() and 0xFF
            if (type == 0x16 && len >= 3) {
                val b1 = raw[i + 2].toInt() and 0xFF
                val b2 = raw[i + 3].toInt() and 0xFF
                if ((b1 == 0x04 && b2 == 0x7A) || (b1 == 0x7A && b2 == 0x04)) {
                    val dLen = len - 3
                    if (dLen > 0) {
                        val d = raw.copyOfRange(i + 4, i + 4 + dLen)
                        val s = String(d, StandardCharsets.UTF_8).trimEnd('\u0000').trim()
                        if (s.isNotEmpty()) return s
                    }
                }
            }
            i += len + 1
        }
        return null
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}

class ConfPresenceBlePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(ConfPresenceBleModule(reactContext))
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
