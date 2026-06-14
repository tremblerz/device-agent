package ai.deviceagent.bluetooth

import java.util.UUID

internal object BluetoothProtocol {
  const val MODULE_NAME = "RNDeviceAgentBluetooth"

  val SERVICE_UUID: UUID = UUID.fromString("f0d3d5cb-8a55-4e95-9c3f-9d8a58c8a101")
  val MESSAGE_UUID: UUID = UUID.fromString("f0d3d5cb-8a55-4e95-9c3f-9d8a58c8a102")
  val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
}
