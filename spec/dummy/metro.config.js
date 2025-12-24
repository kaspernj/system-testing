const path = require("node:path")
const {getDefaultConfig} = require("expo/metro-config")

const config = getDefaultConfig(__dirname)

config.transformer = {
  ...config.transformer,
  minifierPath: path.resolve(__dirname, "./metro.noop-minifier")
}

module.exports = config
