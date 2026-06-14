package ai.deviceagent.bluetooth

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.nio.charset.Charset
import java.util.UUID

data class PeerState(
  val id: String,
  var name: String? = null,
  var rssi: Int? = null,
  var lastSeenAt: Long = System.currentTimeMillis(),
  var connected: Boolean = false,
)

class BluetoothExchangeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), LifecycleEventListener {
  private val bluetoothManager =
    reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
  private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager.adapter

  private var advertiser: BluetoothLeAdvertiser? = null
  private var scanner: BluetoothLeScanner? = null
  private var gattServer: BluetoothGattServer? = null
  private var advertiseCallback: AdvertiseCallback? = null
  private var scanCallback: ScanCallback? = null

  private val peers = linkedMapOf<String, PeerState>()
  private val centralConnections = linkedMapOf<String, BluetoothGatt>()
  private val centralCharacteristics = linkedMapOf<String, BluetoothGattCharacteristic>()
  private val peripheralDevices = linkedMapOf<String, BluetoothDevice>()
  private var started = false
  private var localName: String? = null
  private var serviceUuid: UUID = BluetoothProtocol.SERVICE_UUID
  private val messageUuid: UUID = BluetoothProtocol.MESSAGE_UUID

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName(): String = BluetoothProtocol.MODULE_NAME

  override fun invalidate() {
    stopInternal()
    reactContext.removeLifecycleEventListener(this)
    super.invalidate()
  }

  override fun onHostResume() = Unit

  override fun onHostPause() = Unit

  override fun onHostDestroy() {
    stopInternal()
  }

  @ReactMethod
  fun isSupported(promise: Promise) {
    promise.resolve(bluetoothAdapter != null)
  }

  @ReactMethod
  fun start(options: ReadableMap?, promise: Promise) {
    try {
      if (started) {
        promise.resolve(null)
        return
      }
      val adapter = bluetoothAdapter ?: throw IllegalStateException("Bluetooth is not supported on this device")
      if (!adapter.isEnabled) {
        throw IllegalStateException("Bluetooth is turned off")
      }

      localName = options?.getString("displayName")
      val serviceOverride = options?.getString("serviceUuid")
      if (!serviceOverride.isNullOrBlank()) {
        serviceUuid = UUID.fromString(serviceOverride)
      }

      advertiser = adapter.bluetoothLeAdvertiser
      scanner = adapter.bluetoothLeScanner
      gattServer = bluetoothManager.openGattServer(reactContext, gattServerCallback)

      setupGattServer()
      startAdvertising()
      startScanning()
      started = true
      emit("stateChanged", Arguments.createMap().apply {
        putBoolean("running", true)
        putBoolean("supported", true)
      })
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("bluetooth_start_failed", t)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      stopInternal()
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("bluetooth_stop_failed", t)
    }
  }

  @ReactMethod
  fun getPeers(promise: Promise) {
    val array = Arguments.createArray()
    peers.values.sortedWith(compareByDescending<PeerState> { it.lastSeenAt }.thenBy { it.id }).forEach {
      array.pushMap(peerToMap(it))
    }
    promise.resolve(array)
  }

  @ReactMethod
  fun connect(peerId: String, promise: Promise) {
    try {
      val device = bluetoothAdapter?.getRemoteDevice(peerId)
        ?: throw IllegalStateException("Bluetooth not available")
      if (centralConnections.containsKey(peerId)) {
        promise.resolve(null)
        return
      }
      val gatt =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          device.connectGatt(reactContext, false, centralGattCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
          @Suppress("DEPRECATION")
          device.connectGatt(reactContext, false, centralGattCallback)
        }
      centralConnections[peerId] = gatt
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("bluetooth_connect_failed", t)
    }
  }

  @ReactMethod
  fun disconnect(peerId: String, promise: Promise) {
    try {
      val gatt = centralConnections.remove(peerId)
      gatt?.disconnect()
      gatt?.close()
      centralCharacteristics.remove(peerId)
      peers[peerId]?.connected = false
      peers[peerId]?.let { emit("peerDisconnected", peerToMap(it)) }
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("bluetooth_disconnect_failed", t)
    }
  }

  @ReactMethod
  fun sendMessage(peerId: String, text: String, promise: Promise) {
    try {
      val payload = text.toByteArray(Charset.forName("UTF-8"))
      val gatt = centralConnections[peerId]
      val char = centralCharacteristics[peerId]
      if (gatt != null && char != null) {
        writeCentral(gatt, char, payload)
        promise.resolve(null)
        return
      }

      val device = peripheralDevices[peerId]
      val server = gattServer
      if (device != null && server != null) {
        val service = server.getService(serviceUuid)
          ?: throw IllegalStateException("Bluetooth service is not ready")
        val characteristic = service.getCharacteristic(messageUuid)
          ?: throw IllegalStateException("Bluetooth characteristic is not ready")
        characteristic.value = payload
        val notified = server.notifyCharacteristicChanged(device, characteristic, false)
        if (!notified) {
          throw IllegalStateException("Peer has not subscribed to notifications")
        }
        promise.resolve(null)
        return
      }

      throw IllegalStateException("Peer is not connected or subscribed")
    } catch (t: Throwable) {
      promise.reject("bluetooth_send_failed", t)
    }
  }

  private fun stopInternal() {
    started = false
    stopScanning()
    stopAdvertising()
    centralConnections.values.forEach {
      try {
        it.disconnect()
      } catch (_: Throwable) {
      }
      try {
        it.close()
      } catch (_: Throwable) {
      }
    }
    centralConnections.clear()
    centralCharacteristics.clear()
    peripheralDevices.clear()
    gattServer?.close()
    gattServer = null
    emit("stateChanged", Arguments.createMap().apply {
      putBoolean("running", false)
      putBoolean("supported", bluetoothAdapter != null)
    })
  }

  @SuppressLint("MissingPermission")
  private fun startAdvertising() {
    val adv = advertiser ?: return
    val settings =
      AdvertiseSettings.Builder()
        .setConnectable(true)
        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
        .setTimeout(0)
        .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
        .build()

    val dataBuilder = AdvertiseData.Builder()
      .setIncludeDeviceName(true)
      .addServiceUuid(ParcelUuid(serviceUuid))

    advertiseCallback =
      object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
          super.onStartSuccess(settingsInEffect)
          emit("stateChanged", Arguments.createMap().apply {
            putBoolean("running", true)
            putBoolean("supported", true)
          })
        }

        override fun onStartFailure(errorCode: Int) {
          super.onStartFailure(errorCode)
          emitError("Advertisement failed with code $errorCode")
        }
      }

    adv.startAdvertising(settings, dataBuilder.build(), advertiseCallback)
  }

  @SuppressLint("MissingPermission")
  private fun stopAdvertising() {
    advertiseCallback?.let { callback ->
      advertiser?.stopAdvertising(callback)
    }
    advertiseCallback = null
  }

  @SuppressLint("MissingPermission")
  private fun startScanning() {
    val sc = scanner ?: return
    val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(serviceUuid)).build()
    val settings =
      ScanSettings.Builder()
        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
        .build()

    scanCallback =
      object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
          super.onScanResult(callbackType, result)
          val device = result.device
          val id = device.address
          val peer = peers[id] ?: PeerState(id)
          peer.name = result.scanRecord?.deviceName ?: device.name ?: peer.name
          peer.rssi = result.rssi
          peer.lastSeenAt = System.currentTimeMillis()
          peers[id] = peer
          emit("peerFound", peerToMap(peer))
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>) {
          super.onBatchScanResults(results)
          results.forEach { onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, it) }
        }

        override fun onScanFailed(errorCode: Int) {
          super.onScanFailed(errorCode)
          emitError("Scan failed with code $errorCode")
        }
      }

    sc.startScan(listOf(filter), settings, scanCallback)
  }

  @SuppressLint("MissingPermission")
  private fun stopScanning() {
    scanCallback?.let { callback ->
      scanner?.stopScan(callback)
    }
    scanCallback = null
  }

  @SuppressLint("MissingPermission")
  private fun setupGattServer() {
    val server = gattServer ?: return
    val service =
      android.bluetooth.BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    val characteristic =
      BluetoothGattCharacteristic(
        messageUuid,
        BluetoothGattCharacteristic.PROPERTY_READ or
          BluetoothGattCharacteristic.PROPERTY_WRITE or
          BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
          BluetoothGattCharacteristic.PROPERTY_NOTIFY,
        BluetoothGattCharacteristic.PERMISSION_READ or BluetoothGattCharacteristic.PERMISSION_WRITE,
      )
    val cccd =
      BluetoothGattDescriptor(
        BluetoothProtocol.CCCD_UUID,
        BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
      )
    characteristic.addDescriptor(cccd)
    service.addCharacteristic(characteristic)
    server.addService(service)
  }

  private val gattServerCallback =
    object : BluetoothGattServerCallback() {
      @SuppressLint("MissingPermission")
      override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
        val id = device.address
        val peer = peers[id] ?: PeerState(id)
        peer.connected = newState == BluetoothProfile.STATE_CONNECTED
        peer.name = device.name ?: peer.name
        peers[id] = peer
        peripheralDevices[id] = device
        if (newState == BluetoothProfile.STATE_CONNECTED) {
          emit("peerConnected", peerToMap(peer))
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
          emit("peerDisconnected", peerToMap(peer))
        }
      }

      @SuppressLint("MissingPermission")
      override fun onCharacteristicWriteRequest(
        device: BluetoothDevice,
        requestId: Int,
        characteristic: BluetoothGattCharacteristic,
        preparedWrite: Boolean,
        responseNeeded: Boolean,
        offset: Int,
        value: ByteArray,
      ) {
        if (characteristic.uuid == messageUuid) {
          val text = String(value, Charset.forName("UTF-8"))
          emit("messageReceived", messageMap(device.address, device.name, text, true))
          if (responseNeeded) {
            gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
          }
          return
        }
        if (responseNeeded) {
          gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
        }
      }

      override fun onDescriptorWriteRequest(
        device: BluetoothDevice,
        requestId: Int,
        descriptor: BluetoothGattDescriptor,
        preparedWrite: Boolean,
        responseNeeded: Boolean,
        offset: Int,
        value: ByteArray,
      ) {
        val enabled = value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) ||
          value.contentEquals(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE)
        val id = device.address
        if (enabled) {
          peripheralDevices[id] = device
        } else {
          peripheralDevices.remove(id)
        }
        if (responseNeeded) {
          gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
        }
      }
    }

  private val centralGattCallback =
    object : BluetoothGattCallback() {
      @SuppressLint("MissingPermission")
      override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
        val id = gatt.device.address
        val peer = peers[id] ?: PeerState(id)
        peer.connected = newState == BluetoothProfile.STATE_CONNECTED
        peer.name = gatt.device.name ?: peer.name
        peers[id] = peer
        if (newState == BluetoothProfile.STATE_CONNECTED) {
          emit("peerConnected", peerToMap(peer))
          gatt.discoverServices()
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
          emit("peerDisconnected", peerToMap(peer))
          centralConnections.remove(id)
          centralCharacteristics.remove(id)
        }
      }

      @SuppressLint("MissingPermission")
      override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
        if (status != BluetoothGatt.GATT_SUCCESS) {
          emitError("Service discovery failed for ${gatt.device.address}: $status")
          return
        }
        val service = gatt.getService(serviceUuid)
        val characteristic = service?.getCharacteristic(messageUuid)
        if (characteristic != null) {
          centralCharacteristics[gatt.device.address] = characteristic
          gatt.setCharacteristicNotification(characteristic, true)
          val descriptor = characteristic.getDescriptor(BluetoothProtocol.CCCD_UUID)
          if (descriptor != null) {
            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            gatt.writeDescriptor(descriptor)
          }
        }
      }

      @Suppress("DEPRECATION")
      @SuppressLint("MissingPermission")
      override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
        val text = String(characteristic.value ?: ByteArray(0), Charset.forName("UTF-8"))
        emit("messageReceived", messageMap(gatt.device.address, gatt.device.name, text, true))
      }

      @SuppressLint("MissingPermission")
      override fun onCharacteristicChanged(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
      ) {
        val text = String(value, Charset.forName("UTF-8"))
        emit("messageReceived", messageMap(gatt.device.address, gatt.device.name, text, true))
      }
    }

  @SuppressLint("MissingPermission")
  private fun writeCentral(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, payload: ByteArray) {
    characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
    characteristic.value = payload
    val ok = gatt.writeCharacteristic(characteristic)
    if (!ok) {
      throw IllegalStateException("Failed to write Bluetooth message")
    }
  }

  private fun peerToMap(peer: PeerState): WritableMap {
    return Arguments.createMap().apply {
      putString("id", peer.id)
      putString("name", peer.name)
      putInt("rssi", peer.rssi ?: 0)
      putBoolean("connected", peer.connected)
      putDouble("lastSeenAt", peer.lastSeenAt.toDouble())
    }
  }

  private fun messageMap(peerId: String, peerName: String?, text: String, incoming: Boolean): WritableMap {
    return Arguments.createMap().apply {
      putString("id", "${System.currentTimeMillis()}-$peerId")
      putString("peerId", peerId)
      putString("peerName", peerName)
      putString("text", text)
      putString("direction", if (incoming) "incoming" else "outgoing")
      putDouble("timestamp", System.currentTimeMillis().toDouble())
    }
  }

  private fun emit(eventName: String, params: WritableMap) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, params)
  }

  private fun emitError(message: String) {
    val map = Arguments.createMap().apply {
      putString("error", message)
    }
    emit("error", map)
  }
}
