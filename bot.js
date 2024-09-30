const { Builder, By, until, Capabilities } = require('selenium-webdriver')
const fs = require('fs')
const axios = require('axios')
const chrome = require('selenium-webdriver/chrome')

const SOLUTIONS_PATH = './solutions.md'
const CONFIG_PATH = './config.json'
const COOKIES_LEETCODE_PATH = './cookies_leetcode.json'
const COOKIES_HACKERRANK_PATH = './cookies_hackerrank.json'
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))

const IS_LEETCODE = config.URL.includes('leetcode')
const IS_HACKERRANK = config.URL.includes('hackerrank')
const IS_LEETCODE_STUDY_PLAN = IS_LEETCODE && config.URL.includes('studyplan')
const IS_HACKERRANK_PREPARATION_KIT = IS_HACKERRANK && config.URL.includes('preparation-kits')

const SHORT_WAIT = 3000
const LONG_WAIT = 6000

async function setupBrowser() {
  let chromeCapabilities = Capabilities.chrome()
  chromeCapabilities.set('pageLoadStrategy', 'normal')
  let options = new chrome.Options()
  // options.addArguments('--headless') // Set Chrome to run in headless mode
  options.addArguments(
    'user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.82 Safari/537.36'
  )
  let driver = await new Builder()
    .forBrowser('chrome')
    .withCapabilities(chromeCapabilities)
    .setChromeOptions(options)
    .build()
  return driver
}

async function loadCookies(driver, cookieFile) {
  const cookies = JSON.parse(fs.readFileSync(cookieFile)).forEach(
    async (cookie) => await driver.manage().addCookie(cookie)
  )
  console.log('🍪 loaded')
}

async function saveCookies(driver, cookieFile) {
  const cookies = await driver.manage().getCookies()
  fs.writeFileSync(cookieFile, JSON.stringify(cookies))
  console.log('🍪 saved')
}

async function saveSolutionToFile(lang, taskTitle, taskUrl, descriptionHtml, solution) {
  try {
    fs.appendFileSync(
      SOLUTIONS_PATH,
      `📋 [${taskTitle}](${taskUrl}) for ℹ️ ${lang}:\r\n\r\n📋:\r\n${descriptionHtml}\r\n\r\n📋:\r\n${solution}\r\n---\r\n`
    )
    console.log('📋 saved')
  } catch (error) {
    console.error('🔴 err:', error)
  }
}

async function performLogin(driver, loginUrl, loginElementCss, cookieFile) {
  await driver.executeScript(`window.localStorage.setItem('global_lang', '${config.LANG.toLowerCase()}');`)
  await loadCookies(driver, cookieFile)
  await driver.sleep(SHORT_WAIT)
  await driver.navigate().refresh()
  await driver.sleep(SHORT_WAIT)

  let loggedInElement = await driver.findElements(By.css(loginElementCss))
  if (loggedInElement.length === 0) {
    console.log('ℹ️ not logged in, redirecting to login page...')
    await driver.get(loginUrl)
    await driver.sleep(SHORT_WAIT)
    console.log('ℹ️ Log in manually, solve the CAPTCHA if needed, and press Enter here:')
    process.stdin.once('data', async () => {
      driver.sleep(SHORT_WAIT)
      await saveCookies(driver, cookieFile)
      await performLogin(driver, loginUrl, loginElementCss, cookieFile)
    })
  } else {
    console.log('ℹ️ log in: ok')
  }
}

async function ensureLogin(driver) {
  await driver.get(config.URL)
  const [loginUrl, cookieFile, loginElementCss] = IS_LEETCODE
    ? ['https://leetcode.com/accounts/login/', COOKIES_LEETCODE_PATH, '#navbar_user_avatar']
    : IS_HACKERRANK
    ? ['https://www.hackerrank.com/login', COOKIES_HACKERRANK_PATH, 'button[data-analytics="NavBarProfileDropDown"]']
    : ''

  performLogin(driver, loginUrl, loginElementCss, cookieFile)
}

async function goToNextTask(driver) {
  await driver.get(config.URL)
  await driver.navigate().refresh()
  await driver.sleep(LONG_WAIT)

  const tasksXPath = IS_LEETCODE
    ? IS_LEETCODE_STUDY_PLAN
      ? "//div[contains(@class, 'font-medium') and contains(@class, 'text-lc-text-primary') and contains(@class, 'dark:text-dark-lc-text-primary')]/div[@class='truncate']"
      : "//a[contains(@class, 'h-5 hover:text-blue-s dark:hover:text-dark-blue-s')]"
    : IS_HACKERRANK
    ? '//span[text()="Solve Challenge"]'
    : ''

  const parentXPath = IS_LEETCODE
    ? IS_LEETCODE_STUDY_PLAN
      ? './../../../..'
      : './../..'
    : IS_HACKERRANK
    ? IS_HACKERRANK_PREPARATION_KIT
      ? './../../../..'
      : './../../../../../../..'
    : ''

  const hakerRankTaskTitleXPath = IS_HACKERRANK_PREPARATION_KIT
    ? './/h2[contains(@class, "interview-ch-li-title")]'
    : './/h4[contains(@class, "challengecard-title")]'

  const isLeetCodeTaskUnsolved = (parentHtml) => {
    if (IS_LEETCODE_STUDY_PLAN) {
      // ⚪️ circle withou ✔️ done tick
      return parentHtml.includes(
        'M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 100-16 8 8 0 000 16z'
      )
    } else {
      // does not include premium tag 🏷️
      return !parentHtml.includes('M5.7334 8.3623H7.12988C7.51725 8.3623 7.84766 8.22559')
    }
  }

  let tasks = await driver.findElements(By.xpath(tasksXPath))
  console.log(`📋 found ${tasks.length} tasks on the page.`)

  if (IS_LEETCODE && !IS_LEETCODE_STUDY_PLAN) {
    // skip top 🗓️ task
    tasks = tasks.slice(1)
  }
  let title = ''
  for (let task of tasks) {
    let parent = await task.findElement(By.xpath(parentXPath))
    let parentHtml = await parent.getAttribute('outerHTML')
    const titleElement = IS_HACKERRANK ? await parent.findElement(By.xpath(hakerRankTaskTitleXPath)) : undefined
    if (IS_HACKERRANK || isLeetCodeTaskUnsolved(parentHtml)) {
      title = IS_LEETCODE ? await task.getText() : await titleElement.getText()
      console.log(`📋 found unsolved task: ${title}`)
      await driver.executeScript('arguments[0].scrollIntoView(true);', task)
      if (IS_HACKERRANK) {
        await titleElement.click()
      } else if (IS_LEETCODE_STUDY_PLAN) {
        await task.click()
      } else if (IS_LEETCODE) {
        let taskUrl = await task.getAttribute('href')
        await driver.executeScript(`window.open('${taskUrl}', '_blank');`)
      }
      break
    }
  }
  await driver.sleep(SHORT_WAIT)
  return title
}

async function askGptForSolution(lang, taskTitle, taskUrl, descriptionHtml, codeStub) {
  const prompt = `
    You are a senior ninja engineer. Solve [${taskTitle}](${taskUrl}) for ${lang}:
    ${JSON.stringify(descriptionHtml)}
    Wrap solution code in a \`\`\`lang code block, followed by short comments explaining the solution. 
    Don't put anything else in code block. Code should fill this stub: ${JSON.stringify(
      codeStub
    )}. js means node.js, don't do recursion if not directly asked.
  `
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: config.MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: config.MAX_TOKENS,
      },
      {
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    )
    const gptResponse = response.data.choices[0].message.content.trim()
    return gptResponse
  } catch (error) {
    console.error('🔴 err:', error)
  }
}

async function detectEditor(driver) {
  return await driver.executeScript(`
    if (typeof monaco !== 'undefined' && monaco.editor.getModels().length > 0) {
      return 'monaco';
    } else if (document.querySelector('.CodeMirror')) {
      return 'codemirror';
    } else {
      return 'none';
    }
  `)
}

async function pasteCodeIntoEditor(driver, editorType, code) {
  if (editorType === 'monaco') {
    const codeEditor = await driver.findElement(By.className('monaco-editor'))
    await codeEditor.click()
    await driver.sleep(SHORT_WAIT)
    await driver.executeScript('monaco.editor.getModels()[0].setValue("");')
    await driver.sleep(SHORT_WAIT)
    await driver.executeScript('monaco.editor.getModels()[0].setValue(arguments[0]);', code)
  } else if (editorType === 'codemirror') {
    const codeEditor = await driver.findElement(By.css('.CodeMirror'))
    await codeEditor.click()
    await driver.sleep(SHORT_WAIT)
    await driver.executeScript(
      `
      var editor = document.querySelector('.CodeMirror').CodeMirror;
      editor.setValue(arguments[0]);
    `,
      code
    )
  }
}

async function submitCode(driver, editorType) {
  if (IS_LEETCODE) {
    await driver.findElement(By.css('button[data-e2e-locator="console-submit-button"]')).click()
  } else if (IS_HACKERRANK && editorType === 'monaco') {
    await driver.executeScript('document.querySelector(".hr-monaco-submit").click();')
  } else if (IS_HACKERRANK && editorType === 'codemirror') {
    const submitButton = await driver.findElement(By.xpath('//button[contains(text(), "Submit Code")]'))
    await submitButton.click()
  }
  await driver.sleep(LONG_WAIT)
}

async function setLang(driver) {
  if (IS_HACKERRANK) {
    const dropdown = await driver.findElement(By.css('div.custom-select.select-language, div.select2-container'))
    await dropdown.click()
    console.log('ℹ️ lang dropdown click')
    await driver.sleep(SHORT_WAIT / 2)
    const langOption = await driver.findElement(
      By.xpath(
        `//div[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "${config.LANG.toLowerCase()}")]`
      )
    )
    await langOption.click()
    console.log('ℹ️ lang selected')
  }
  await driver.sleep(SHORT_WAIT / 2)
}

async function solve(driver, taskTitle, lang) {
  let taskUrl = await driver.getCurrentUrl()
  await driver.sleep(SHORT_WAIT)
  let tabs = await driver.getAllWindowHandles()
  await driver.switchTo().window(tabs[tabs.length - 1])
  await driver.sleep(SHORT_WAIT)
  let descriptionDiv = IS_LEETCODE
    ? await driver.wait(until.elementLocated(By.css("div.elfjS[data-track-load='description_content']")), LONG_WAIT)
    : await driver.wait(until.elementLocated(By.className('challenge-body-html')), LONG_WAIT)
  let descriptionHtml = IS_LEETCODE ? await descriptionDiv.getAttribute('innerHTML') : await descriptionDiv.getText()
  console.log('📋 description', descriptionHtml)

  await setLang(driver)

  const editorType = await detectEditor(driver)

  let codeStub =
    editorType === 'monaco'
      ? await driver.executeScript('return monaco.editor.getModels()[0].getValue();')
      : await driver.executeScript(`
    return document.querySelector('.CodeMirror').CodeMirror.getValue();
  `)
  console.log('📋 code stub', codeStub)
  const solution = await askGptForSolution(lang, taskTitle, taskUrl, descriptionHtml, codeStub)
  saveSolutionToFile(lang, taskTitle, taskUrl, descriptionHtml, solution)

  const codeBlockRegex = /```(?:[a-z]+)?\s*([\s\S]*?)```/i
  const match = solution.match(codeBlockRegex)
  const code = match ? match[1].trim() : solution.trim()
  console.log('📋 code from gpt:', JSON.stringify(code))

  await pasteCodeIntoEditor(driver, editorType, code)
  submitCode(driver, editorType)
  if (IS_LEETCODE) {
    await driver.wait(until.elementLocated(By.xpath("//div[text()='All Submissions']")), LONG_WAIT)
    await driver.sleep(SHORT_WAIT)
    await driver.close() // close the active tab
    await driver.switchTo().window(tabs[0])
    await driver.navigate().refresh()
  } else if (IS_HACKERRANK) {
    await driver.wait(until.elementLocated(By.className('testcase-results')), SHORT_WAIT)
    await driver.wait(until.elementIsVisible(driver.findElement(By.className('testcase-results'))), SHORT_WAIT)
  }
  await driver.sleep(SHORT_WAIT)
}

;(async function main() {
  try {
    console.log(`URL: ${config.URL}, lang: ${config.LANG}`)
    let driver = await setupBrowser()
    await ensureLogin(driver)
    let taskTitle = await goToNextTask(driver)
    while (taskTitle !== '') {
      try {
        await solve(driver, taskTitle, config.LANG)
        taskTitle = await goToNextTask(driver)
      } catch (err) {
        console.error('🔴 err:', err)
      }
    }
  } finally {
    // await driver.quit()
  }
})()
