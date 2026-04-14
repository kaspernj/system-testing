import {buildAppiumWebCapabilities, buildAppiumWebTestEnv, resolveChromedriverDownload} from "../scripts/test-appium-web.js"

describe("test-appium-web helpers", () => {
  it("prefers the closest matching chromedriver for the current Chrome build", () => {
    const result = resolveChromedriverDownload({
      browserVersion: "145.0.7632.116",
      chromeForTestingVersions: [
        {
          version: "145.0.7632.67",
          downloads: {
            chromedriver: [
              {
                platform: "linux64",
                url: "https://example.com/145.0.7632.67.zip"
              }
            ]
          }
        },
        {
          version: "145.0.7632.117",
          downloads: {
            chromedriver: [
              {
                platform: "linux64",
                url: "https://example.com/145.0.7632.117.zip"
              }
            ]
          }
        }
      ],
      platform: "linux64"
    })

    expect(result).toEqual({
      downloadUrl: "https://example.com/145.0.7632.117.zip",
      version: "145.0.7632.117"
    })
  })

  it("falls back to the same Chrome major when an exact build is unavailable", () => {
    const result = resolveChromedriverDownload({
      browserVersion: "146.0.1000.10",
      chromeForTestingVersions: [
        {
          version: "145.0.7632.117",
          downloads: {
            chromedriver: [
              {
                platform: "linux64",
                url: "https://example.com/145.0.7632.117.zip"
              }
            ]
          }
        },
        {
          version: "146.0.999.2",
          downloads: {
            chromedriver: [
              {
                platform: "linux64",
                url: "https://example.com/146.0.999.2.zip"
              }
            ]
          }
        }
      ],
      platform: "linux64"
    })

    expect(result).toEqual({
      downloadUrl: "https://example.com/146.0.999.2.zip",
      version: "146.0.999.2"
    })
  })

  it("builds explicit Appium web capabilities with a pinned chromedriver executable", () => {
    expect(buildAppiumWebCapabilities({
      chromeBinary: "/usr/bin/google-chrome",
      chromedriverPath: "/tmp/chromedriver/chromedriver"
    })).toEqual({
      platformName: "linux",
      browserName: "chrome",
      "appium:automationName": "Chromium",
      "appium:autodownloadEnabled": false,
      "appium:executable": "/tmp/chromedriver/chromedriver",
      "goog:chromeOptions": {
        binary: "/usr/bin/google-chrome",
        args: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
      }
    })
  })

  it("forces localhost as the dist HTTP connect host for Appium web runs", () => {
    const env = buildAppiumWebTestEnv({
      capabilities: {browserName: "chrome"},
      baseEnv: {SYSTEM_TEST_HTTP_CONNECT_HOST: "10.0.2.2", PATH: "/usr/bin"}
    })

    expect(env).toEqual(jasmine.objectContaining({
      PATH: "/usr/bin",
      SYSTEM_TEST_HOST: "dist",
      SYSTEM_TEST_HTTP_CONNECT_HOST: "127.0.0.1",
      SYSTEM_TEST_DRIVER: "appium",
      SYSTEM_TEST_APPIUM_DRIVERS: "chromium",
      SYSTEM_TEST_APPIUM_TEST_ID_STRATEGY: "css",
      SYSTEM_TEST_APPIUM_CAPABILITIES: JSON.stringify({browserName: "chrome"})
    }))
  })
})
