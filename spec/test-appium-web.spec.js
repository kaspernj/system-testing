import {buildAppiumWebCapabilities, resolveChromedriverDownload} from "../scripts/test-appium-web.js"

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
})
