import { useState } from "react";
import "./App.css";

const DEEPLAPITOKENREGEX = /^.{20,}:fx$/i;

class DeepLUsageResponse {
  constructor(usageResponse) {
    this.characterCount = usageResponse.character_count;
    this.characterLimit = usageResponse.character_limit;
  }
}

/**
 * @typedef DeepLTokenInfoInStorage
 * @type {object}
 * @param {*} ms 
 * @returns 
 */

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MockStorageSync {
  constructor() {
    this.storage = [];
  }
  async getDeepLTokens() {
    await sleep(100);
    return this.storage;
  }

  async setDeepLToken(tokenObject) {
    await sleep(100);
    this.storage.push(tokenObject);
  }

  async removeDeepLToken(tokenKey) {
    await sleep(100);
    this.storage = this.storage.filter((item) => item.key !== tokenKey);
  }

  async getDeeplTokenKey(tokenKey) {
    await sleep(100);
    return this.storage.find((item) => item.key === tokenKey);
  }
}

const mockStorageSync = new MockStorageSync();

function Header() {
  return (
    <div className="header-section">
      <div className="text-start">
        <h1>Settings</h1>
      </div>
    </div>
  );
}

function validateDeeplApiTokenKey(tokenKey) {
  if (typeof tokenKey !== "string" || tokenKey.length === 0) {
    return false;
  }

  if (!DEEPLAPITOKENREGEX.test(tokenKey)) {
    return false;
  }

  return true;
}

async function checkIfDeepLApiTokenValid(tokenKey, tokenType) {
  const url =
    tokenType === "free" ? "https://api-free.deepl.com/v2/usage" : "https://api.deepl.com/v2/usage";

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `DeepL-Auth-Key ${tokenKey}`,
      },
    });
    if (!response.ok) {
      const errorMessage = `
        Checking token usage failed with error code ${response.status} and message ${response.statusText}
      `;
      return new Error(errorMessage);
    }

    const data = await response.json();
    const deepLUsageResponse = new DeepLUsageResponse(data);
    return deepLUsageResponse;
  } catch (error) {
    const errorMessage = `
      Parsing usage response failed with ${error}.
      Probably network error or DeepL has changed response format.
      Please contact extension developers for this issue.
    `;
    console.error(errorMessage);
    return error;
  }
}

function AddNewTokenForm() {
  async function handleSubmit(event) {
    event.preventDefault();
    const formElement = event.target;
    const formData = new FormData(formElement);

    const deepLApiTokenKey = formData.get("apiTokenKey");
    const deepLApiTokenType = formData.get("apiTokenType");

    if (!validateDeeplApiTokenKey(deepLApiTokenKey)) {
      alert(
        "Please enter a valid DeepL API token. Sample DeepL Token format: xxxxxxxxxxxxxxxxxxxx:fx"
      );
      return;
    }

    if (!deepLApiTokenType) {
      alert("Please select an API type.");
      return;
    }

    const existedDeepLTokenKey = await mockStorageSync.getDeeplTokenKey(deepLApiTokenKey);
    if (existedDeepLTokenKey) {
      alert("You have already added this token.");
      return;
    }

    const deepLTokenUsageResponse = await checkIfDeepLApiTokenValid(
      deepLApiTokenKey,
      deepLApiTokenType
    );
    console.log("deepl token usage response", deepLTokenUsageResponse);
    if (deepLTokenUsageResponse instanceof Error) {
      alert("The provided DeepL API token is not valid. Please check and try again.");
      return;
    }

    console.log("DeepL API Token Key:", deepLApiTokenKey);
    console.log("DeepL API Token Type:", deepLApiTokenType);

    await mockStorageSync.setDeepLToken({
      key: deepLApiTokenKey,
      type: deepLApiTokenType,
    });

    console.log("Mock storage type", mockStorageSync.storage);

    formElement.reset();
  }

  return (
    <form className="add-token-form" onSubmit={handleSubmit}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <label className="form-text">New token</label>
        <input
          type="text"
          name="apiTokenKey"
          className="input-field"
          placeholder="Add your DeepL token here"
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <label className="form-text">API Type</label>

        <div className="radio-group">
          <label className="radio-option">
            <input type="radio" name="apiTokenType" value="free" />
            <div className="radio-content">
              <div className="radio-title">DeepL Free</div>
              <div className="radio-description">For personal and non-commercial use</div>
            </div>
          </label>

          <label className="radio-option">
            <input type="radio" name="apiTokenType" value="pro" />
            <div className="radio-content">
              <div className="radio-title">DeepL Pro</div>
              <div className="radio-description">For subscription use with high limit</div>
            </div>
          </label>
        </div>
      </div>

      <button type="submit" className="button" style={{ margin: "8px 0" }}>
        Add new token
      </button>
    </form>
  );
}

function TokenManagementSection() {
  return <></>;
}

function TokenManagementAccordion() {
  const [accordionOpen, setAccordionOpen] = useState(false);

  return (
    <div className="container">
      <div className={`accordion ${accordionOpen ? "active" : ""}`}>
        <button className="accordion-header" onClick={() => setAccordionOpen(!accordionOpen)}>
          <span>Tokens Management</span>
          <span className="accordion-icon">&#9660;</span>
        </button>
        <div className="accordion-content">
          <div className="accordion-content-inner">
            <p className="section-title">
              Manage your DeepL API tokens to enable translation service.
            </p>

            <p className="section-text">
              Currently, only&nbsp;
              <a href="https://www.deepl.com/pro-api" target="_blank" rel="noopener noreferrer">
                DeepL, the best translation service for Finnish language
              </a>
              &nbsp;is supported.
              <br />
              You can upload up to 5 tokens. View&nbsp;
              <a
                href="https://support.deepl.com/hc/en-us/articles/360020695820-API-key-for-DeepL-API"
                target="_blank"
                rel="noopener noreferrer"
              >
                this guide
              </a>
              &nbsp;to get an API token.
            </p>

            <AddNewTokenForm />
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <>
      <div className="extension-body">
        <Header />

        <TokenManagementAccordion />
      </div>
    </>
  );
}

export default App;
