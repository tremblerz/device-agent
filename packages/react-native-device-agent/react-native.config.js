module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import ai.deviceagent.bluetooth.BluetoothExchangePackage;',
        packageInstance: 'new BluetoothExchangePackage()',
      },
      ios: {
        sourceDir: './ios',
      },
    },
  },
};
