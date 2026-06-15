import CoreBluetooth
import Foundation
import React

@objc(RNDeviceAgentBluetooth)
class RNDeviceAgentBluetooth: RCTEventEmitter, CBCentralManagerDelegate, CBPeripheralDelegate, CBPeripheralManagerDelegate {
  private struct PeerState {
    var id: String
    var name: String?
    var rssi: Int?
    var lastSeenAt: TimeInterval = Date().timeIntervalSince1970 * 1000
    var connected: Bool = false
  }

  private var serviceUuid = CBUUID(string: "f0d3d5cb-8a55-4e95-9c3f-9d8a58c8a101")
  private let messageUuid = CBUUID(string: "f0d3d5cb-8a55-4e95-9c3f-9d8a58c8a102")

  private var centralManager: CBCentralManager?
  private var peripheralManager: CBPeripheralManager?
  private var messageCharacteristic: CBMutableCharacteristic?
  private var service: CBMutableService?
  private var localName: String?

  private var started = false
  private var scanning = false
  private var advertising = false
  private var readyToAdvertise = false
  private var readyToScan = false

  private var peers: [String: PeerState] = [:]
  private var discoveredPeers: [String: CBPeripheral] = [:]
  private var centralConnections: [String: CBPeripheral] = [:]
  private var subscribedPeers: Set<String> = []
  private var pendingMessages: [Data] = []

  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String]! {
    ["peerFound", "peerLost", "peerConnected", "peerDisconnected", "messageReceived", "stateChanged", "error"]
  }

  @objc(isSupported:rejecter:)
  func isSupported(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(CBManager.authorization != .denied)
  }

  @objc(start:resolver:rejecter:)
  func start(_ options: NSDictionary?, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      if self.started {
        resolve(nil)
        return
      }

      self.localName = options?["displayName"] as? String
      if let serviceOverride = options?["serviceUuid"] as? String, !serviceOverride.isEmpty {
        self.serviceUuid = CBUUID(string: serviceOverride)
      }

      self.centralManager = CBCentralManager(delegate: self, queue: .main)
      self.peripheralManager = CBPeripheralManager(delegate: self, queue: .main)
      self.started = true
      self.emitState()
      resolve(nil)
    }
  }

  @objc(stop:rejecter:)
  func stop(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      self.stopInternal()
      resolve(nil)
    }
  }

  @objc(getPeers:rejecter:)
  func getPeers(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let items = peers.values.sorted { lhs, rhs in
      if lhs.lastSeenAt == rhs.lastSeenAt {
        return lhs.id < rhs.id
      }
      return lhs.lastSeenAt > rhs.lastSeenAt
    }.map { peer -> [String: Any] in
      [
        "id": peer.id,
        "name": peer.name as Any,
        "rssi": peer.rssi as Any,
        "connected": peer.connected,
        "lastSeenAt": peer.lastSeenAt,
      ]
    }
    resolve(items)
  }

  @objc(connect:resolver:rejecter:)
  func connect(_ peerId: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      guard let peripheral = self.discoveredPeers[peerId] else {
        reject("bluetooth_connect_failed", "Peer not discovered", nil)
        return
      }
      self.centralConnections[peerId] = peripheral
      self.centralManager?.connect(peripheral, options: nil)
      resolve(nil)
    }
  }

  @objc(disconnect:resolver:rejecter:)
  func disconnect(_ peerId: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      if let peripheral = self.centralConnections.removeValue(forKey: peerId) {
        self.centralManager?.cancelPeripheralConnection(peripheral)
      }
      self.subscribedPeers.remove(peerId)
      if var peer = self.peers[peerId] {
        peer.connected = false
        self.peers[peerId] = peer
        self.emit(name: "peerDisconnected", body: self.peerDict(peer))
      }
      resolve(nil)
    }
  }

  @objc(sendMessage:message:resolver:rejecter:)
  func sendMessage(_ peerId: String, message: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      guard let data = message.data(using: .utf8) else {
        reject("bluetooth_send_failed", "Could not encode message", nil)
        return
      }

      if let peripheral = self.centralConnections[peerId],
         let service = peripheral.services?.first(where: { $0.uuid == self.serviceUuid }),
         let characteristic = service.characteristics?.first(where: { $0.uuid == self.messageUuid }) {
        peripheral.writeValue(data, for: characteristic, type: .withResponse)
        resolve(nil)
        return
      }

      guard let characteristic = self.messageCharacteristic else {
        reject("bluetooth_send_failed", "Bluetooth service is not ready", nil)
        return
      }

      if self.peripheralManager?.updateValue(data, for: characteristic, onSubscribedCentrals: nil) == true {
        resolve(nil)
        return
      }

      reject("bluetooth_send_failed", "Peer is not connected or subscribed", nil)
    }
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state == .poweredOn {
      readyToScan = true
      startScanningIfNeeded()
      emitState()
    } else {
      emitError("Central manager state: \(central.state.rawValue)")
    }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    let id = peripheral.identifier.uuidString
    discoveredPeers[id] = peripheral
    peripheral.delegate = self
    var peer = peers[id] ?? PeerState(id: id)
    peer.name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name ?? peer.name
    peer.rssi = RSSI.intValue
    peer.lastSeenAt = Date().timeIntervalSince1970 * 1000
    peers[id] = peer
    emit(name: "peerFound", body: peerDict(peer))
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    let id = peripheral.identifier.uuidString
    var peer = peers[id] ?? PeerState(id: id)
    peer.connected = true
    peer.name = peripheral.name ?? peer.name
    peers[id] = peer
    emit(name: "peerConnected", body: peerDict(peer))
    peripheral.discoverServices([serviceUuid])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    emitError("Failed to connect to \(peripheral.identifier.uuidString): \(error?.localizedDescription ?? "unknown error")")
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    let id = peripheral.identifier.uuidString
    centralConnections.removeValue(forKey: id)
    var peer = peers[id] ?? PeerState(id: id)
    peer.connected = false
    peers[id] = peer
    emit(name: "peerDisconnected", body: peerDict(peer))
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil else {
      emitError("Service discovery failed: \(error!.localizedDescription)")
      return
    }
    guard let service = peripheral.services?.first(where: { $0.uuid == serviceUuid }) else {
      return
    }
    peripheral.discoverCharacteristics([messageUuid], for: service)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard error == nil else {
      emitError("Characteristic discovery failed: \(error!.localizedDescription)")
      return
    }
    guard let characteristic = service.characteristics?.first(where: { $0.uuid == messageUuid }) else {
      return
    }
    peripheral.setNotifyValue(true, for: characteristic)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard error == nil else {
      emitError("Notification error: \(error!.localizedDescription)")
      return
    }
    guard let data = characteristic.value, let text = String(data: data, encoding: .utf8) else {
      return
    }
    let peerId = peripheral.identifier.uuidString
    let peerName = peripheral.name
    emit(name: "messageReceived", body: messageDict(peerId: peerId, peerName: peerName, text: text, incoming: true))
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    if peripheral.state == .poweredOn {
      readyToAdvertise = true
      setupGattIfNeeded()
      startAdvertisingIfNeeded()
      emitState()
    } else {
      emitError("Peripheral manager state: \(peripheral.state.rawValue)")
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
    subscribedPeers.insert(central.identifier.uuidString)
    if var peer = peers[central.identifier.uuidString] {
      peer.connected = true
      peers[central.identifier.uuidString] = peer
      emit(name: "peerConnected", body: peerDict(peer))
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
    subscribedPeers.remove(central.identifier.uuidString)
    if var peer = peers[central.identifier.uuidString] {
      peer.connected = false
      peers[central.identifier.uuidString] = peer
      emit(name: "peerDisconnected", body: peerDict(peer))
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    for request in requests {
      guard let data = request.value, let text = String(data: data, encoding: .utf8) else {
        peripheral.respond(to: request, withResult: .unlikelyError)
        continue
      }
      let peerId = request.central.identifier.uuidString
      let peerName = request.central.maximumUpdateValueLength > 0 ? request.central.identifier.uuidString : nil
      emit(name: "messageReceived", body: messageDict(peerId: peerId, peerName: peerName, text: text, incoming: true))
      peripheral.respond(to: request, withResult: .success)
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    guard error == nil else {
      emitError("Failed to add BLE service: \(error!.localizedDescription)")
      return
    }
    startAdvertisingIfNeeded()
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    flushPendingMessages()
  }

  private func setupGattIfNeeded() {
    guard messageCharacteristic == nil else {
      return
    }

    let characteristic = CBMutableCharacteristic(
      type: messageUuid,
      properties: [.read, .write, .writeWithoutResponse, .notify],
      value: nil,
      permissions: [.readable, .writeable]
    )
    let service = CBMutableService(type: serviceUuid, primary: true)
    service.characteristics = [characteristic]
    self.service = service
    self.messageCharacteristic = characteristic
    peripheralManager?.add(service)
  }

  private func startAdvertisingIfNeeded() {
    guard readyToAdvertise, !advertising else {
      return
    }
    guard let peripheralManager, messageCharacteristic != nil else {
      return
    }
    guard peripheralManager.isAdvertising == false else {
      advertising = true
      return
    }

    let name = localName ?? UIDevice.current.name
    peripheralManager.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [serviceUuid],
      CBAdvertisementDataLocalNameKey: name,
    ])
    advertising = true
  }

  private func startScanningIfNeeded() {
    guard readyToScan, !scanning else {
      return
    }
    centralManager?.scanForPeripherals(withServices: [serviceUuid], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    scanning = true
  }

  private func stopInternal() {
    if scanning {
      centralManager?.stopScan()
    }
    if advertising {
      peripheralManager?.stopAdvertising()
    }
    centralConnections.values.forEach { centralManager?.cancelPeripheralConnection($0) }
    centralConnections.removeAll()
    discoveredPeers.removeAll()
    subscribedPeers.removeAll()
    peers.removeAll()
    pendingMessages.removeAll()
    messageCharacteristic = nil
    service = nil
    started = false
    scanning = false
    advertising = false
    readyToAdvertise = false
    readyToScan = false
    emitState()
  }

  private func flushPendingMessages() {
    guard let characteristic = messageCharacteristic, let peripheralManager else {
      return
    }
    while !pendingMessages.isEmpty {
      let data = pendingMessages.removeFirst()
      let ok = peripheralManager.updateValue(data, for: characteristic, onSubscribedCentrals: nil)
      if !ok {
        pendingMessages.insert(data, at: 0)
        return
      }
    }
  }

  private func peerDict(_ peer: PeerState) -> [String: Any] {
    [
      "id": peer.id,
      "name": peer.name as Any,
      "rssi": peer.rssi as Any,
      "connected": peer.connected,
      "lastSeenAt": peer.lastSeenAt,
    ]
  }

  private func messageDict(peerId: String, peerName: String?, text: String, incoming: Bool) -> [String: Any] {
    [
      "id": "\(Int(Date().timeIntervalSince1970 * 1000))-\(peerId)",
      "peerId": peerId,
      "peerName": peerName as Any,
      "text": text,
      "direction": incoming ? "incoming" : "outgoing",
      "timestamp": Date().timeIntervalSince1970 * 1000,
    ]
  }

  private func emitState() {
    emit(name: "stateChanged", body: [
      "supported": true,
      "running": started,
    ])
  }

  private func emitError(_ message: String) {
    emit(name: "error", body: ["error": message])
  }

  private func emit(name: String, body: Any?) {
    sendEvent(withName: name, body: body)
  }
}
