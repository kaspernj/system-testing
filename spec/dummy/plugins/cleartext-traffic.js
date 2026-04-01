const {withAndroidManifest} = require("@expo/config-plugins")

/** Enables cleartext HTTP traffic for system test WebSocket connections. */
module.exports = function cleartextTraffic(config) {
  return withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application?.[0]

    if (mainApplication?.$) {
      mainApplication.$["android:usesCleartextTraffic"] = "true"
    }

    return config
  })
}
