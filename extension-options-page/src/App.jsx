import { useEffect, useState } from "react";
import { Trash2, RefreshCw, Check } from "lucide-react";
import "./App.css";

const DEEPLAPITOKENREGEX = /^.{20,}:fx$/i;

class DeepLUsageResponse {
  /**
   * Init DeepLUsageResponse from DeepL API usage response object
   * @param {Object} usageResponse - The response object from DeepL API usage endpoint.
   * @returns
   */
  constructor(usageResponse) {
    const errorMessage = `Error when parsing usage response from DeepL: ${usageResponse}`;
    if (!usageResponse || typeof usageResponse !== "object") {
      throw new Error(errorMessage);
    }
    if (
      typeof usageResponse.character_count !== "number" ||
      typeof usageResponse.character_limit !== "number"
    ) {
      throw new Error(errorMessage);
    }
    if (isNaN(usageResponse.character_count) || isNaN(usageResponse.character_limit)) {
      throw new Error(errorMessage);
    }

    /**
     * @type {number}
     * @description The number of characters already translated in the month
     */
    this.characterCount = usageResponse.character_count;
    /**
     * @type {number}
     * @description The character limit for the current month
     */
    this.characterLimit = usageResponse.character_limit;
  }
}

/**
 * @typedef DeepLTokenInfoInStorage
 * @type {object}
 * @property {string} key - The DeepL API token key.
 * @property {string} type - The DeepL API token type, either free or pro.
 * @property {string} characterCount - The number of characters translated using this token.
 * @property {string} characterLimit - The character limit for this token.
 * @property {string} lastUsageCheckedAt - The timestamp when the token usage was last checked.
 * @property {boolean} selected - Whether this token is selected for use.
 */

/**
 * Sleep for a specified number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @type {DeepLTokenInfoInStorage[]}
 */
const chromeStorageSync = {};

class ChromeStorageSyncHandler {
  /**
   *
   * @param {DeepLTokenInfoInStorage} tokenInfo
   * @returns
   */
  static async saveDeepLToken(tokenInfo) {
    const { key: tokenKey } = tokenInfo;

    await sleep(100);

    chromeStorageSync[tokenKey] = tokenInfo;
  }

  /**
   * @returns {Promise<DeepLTokenInfoInStorage[]>}
   */
  static async getAllDeepLTokens() {
    await sleep(100);

    return Object.values(chromeStorageSync);
  }

  /**
   * @param {string} tokenKey
   * @returns {Promise<DeepLTokenInfoInStorage | undefined>}
   */
  static async getDeepLToken(tokenKey) {
    await sleep(100);

    return chromeStorageSync[tokenKey];
  }
}

function Header() {
  return (
    <div className="header-section">
      <h1>Settings</h1>
    </div>
  );
}

/**
 *
 * @param {string} tokenKey - The DeepL API token key to validate.
 * @returns
 */
function validateDeeplApiTokenKey(tokenKey) {
  if (typeof tokenKey !== "string" || tokenKey.length === 0) {
    return false;
  }

  if (!DEEPLAPITOKENREGEX.test(tokenKey)) {
    return false;
  }

  return true;
}

/**
 *
 * @param {string} tokenKey
 * @param {"free" | "pro"} tokenType
 * @returns {Promise<[true, DeepLUsageResponse]|[false, string]>} -
 * Returns a tuple where the first element indicates validity and the second is either usage data or an error message.
 */
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
      return [false, errorMessage];
    }

    const data = await response.json();
    const deepLUsageResponse = new DeepLUsageResponse(data);
    return [true, deepLUsageResponse];
  } catch (error) {
    const errorMessage = `
      Parsing usage response failed with ${error}.
      Probably network error or DeepL has changed response format.
      Please contact extension developers for this issue.
    `;
    console.error(errorMessage);
    return [false, errorMessage];
  }
}

/**
 * 
 * @param {number} num 
 * @returns 
 * @description Format number with commas as thousands separators. Example: 1234567 -> "1,234,567"
 */
function formatCharacterUsageNumber(num) {
  return num.toLocaleString();
}

function formatDate(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

/**
 *
 * @param {string} word
 * @returns {string}
 */
function capitalizeFirstLetter(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * @typedef {Object} TokenInfoCardProps
 * @property {DeepLTokenInfoInStorage} tokenInfo - The DeepL token information to display.
 */

/**
 *
 * @param {TokenInfoCardProps} props
 * @returns
 */
function TokenInfoCard(props) {
  const { tokenInfo } = props;
  const usagePercentage = (tokenInfo.characterCount / tokenInfo.characterLimit * 100).toFixed(1);
  return (
    <div
      key={tokenInfo.key}
      // onClick={() => handleSelectToken(tokenInfo.key)}
      className={`token-card ${tokenInfo.selected ? "token-card-selected" : ""}`}
    >
      <div className="token-card__content">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="token-card__header">
            <div className={`token-card__checkbox ${tokenInfo.selected ? "token-card__checkbox-selected" : ""}`}>
              {tokenInfo.selected && <Check size={14} className="check-icon" />}
            </div>
            <div className="token-card__details">
              <h3 className="token-card__token-type">DeepL {capitalizeFirstLetter(tokenInfo.type)}</h3>
              <p className="token-card__token-key">{tokenInfo.token}</p>
            </div>
          </div>

          <div className="token-card__usage-container">
            <div className="token-card__usage-stats">
              <span className="token-card__usage-text">
                {formatCharacterUsageNumber(tokenInfo.characterCount)} / {formatCharacterUsageNumber(tokenInfo.characterLimit)}{" "}
                characters
              </span>
              <span className="token-card__usage-percentage">{usagePercentage}%</span>
            </div>

            <div className="token-card__progress-bar">
              <div
                className={`token-card__progress-fill token-card__progress-green`}
                style={{ width: `${Math.min(usagePercentage, 100)}%` }}
              ></div>
            </div>

            <p className="token-card__last-checked-text">
              Last checked: {formatDate(tokenInfo.lastUsageCheckedAt)}
            </p>
          </div>
        </div>

        <div className="token-card__action-buttons">
          <button
            onClick={(e) => {
              e.stopPropagation();
              // handleCheckUsage(token.id);
            }}
            className="token-card__button token-card__check-usage-button"
          >
            <RefreshCw size={16} />
            Check Usage
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              // handleRemoveToken(token.id);
            }}
            className="token-card__button token-card__remove_button"
          >
            <Trash2 size={16} />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 *
 */
function TokenInfoCardList() {
  /** @type {DeepLTokenInfoInStorage[]} */
  const tokens = [
    {
      key: "xxxxxxxxxxxxxxxxxxxx:fx",
      type: "free",
      characterCount: 12345,
      characterLimit: 500000,
      lastUsageCheckedAt: new Date().toISOString(),
    },
    {
      key: "yyyyyyyyyyyyyyyyyyyy:fx",
      type: "pro",
      characterCount: 67890,
      characterLimit: 1000000,
      lastUsageCheckedAt: new Date().toISOString(),
    },
  ];
  return (
    <div>
      <p>Here is your list of tokens:</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "18px", marginTop: "20px" }}>
        {tokens.map((tokenInfo) => (
          <TokenInfoCard key={tokenInfo.key} tokenInfo={tokenInfo} />
        ))}
      </div>
    </div>
  );
}

/**
 * @typedef {Object} AddNewTokenFormProps
 * @property {Map<string, DeepLTokenInfoInStorage>} tokenInfosMap - A map of DeepL tokens.
 * @property {(newTokenInfos: Map<string, DeepLTokenInfoInStorage> ) => void} setTokenInfosMap - A function to update the tokenInfosMap.
 */

/**
 * @param {AddNewTokenFormProps} props
 * @returns
 */
function AddNewTokenForm(props) {
  const { tokenInfosMap, setTokenInfosMap } = props;
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

    const existingTokenInfo = await ChromeStorageSyncHandler.getDeepLToken(deepLApiTokenKey);
    if (existingTokenInfo) {
      alert("You have already added this token.");
      return;
    }

    const [validateSuccess, checkTokenUsageResponse] = await checkIfDeepLApiTokenValid(
      deepLApiTokenKey,
      deepLApiTokenType
    );
    if (!validateSuccess) {
      const checkTokenUsageErrorMessage = checkTokenUsageResponse;
      alert(
        `The provided DeepL API token is not valid.
        Checking token usage failed with error: ${checkTokenUsageErrorMessage}.
        Please check and try again.`
      );
      return;
    }

    const deepLUsageResponse = checkTokenUsageResponse;

    /**
     * @type {DeepLTokenInfoInStorage}
     */
    const deeplTokenInfoInStorage = {
      key: deepLApiTokenKey,
      type: deepLApiTokenType,
      characterCount: deepLUsageResponse.characterCount,
      characterLimit: deepLUsageResponse.characterLimit,
      lastUsageCheckedAt: new Date().toISOString(),
    };

    await ChromeStorageSyncHandler.saveDeepLToken(deeplTokenInfoInStorage);

    const updatedTokenInfosMap = new Map(tokenInfosMap);
    updatedTokenInfosMap.set(deepLApiTokenKey, deeplTokenInfoInStorage);
    setTokenInfosMap(updatedTokenInfosMap);

    formElement.reset();

    tokenInfosMap.clear();
  }

  return (
    <form className="add-token-form" onSubmit={handleSubmit}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <label className="add-token-form__input-label">New token</label>
        <input
          type="text"
          name="apiTokenKey"
          className="add-token-form__input-field"
          placeholder="Add your DeepL token here"
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <label className="add-token-form__input-label">API Type</label>

        <div className="add-token-form__radio-group">
          <label className="add-token-form__radio-option">
            <input type="radio" name="apiTokenType" value="free" />
            <div className="add-token-form__radio-content">
              <div className="add-token-form__radio-title">DeepL Free</div>
              <div className="add-token-form__radio-description">
                For personal and non-commercial use
              </div>
            </div>
          </label>

          <label className="add-token-form__radio-option">
            <input type="radio" name="apiTokenType" value="pro" />
            <div className="add-token-form__radio-content">
              <div className="add-token-form__radio-title">DeepL Pro</div>
              <div className="add-token-form__radio-description">
                For subscription use with high limit
              </div>
            </div>
          </label>
        </div>
      </div>

      <button type="submit" className="add-token-form__button" style={{ margin: "8px 0" }}>
        Add new token
      </button>
    </form>
  );
}

function TokenManagementSection() {
  /**
   * @type {[Map<string, DeepLTokenInfoInStorage>, Function]}
   */
  const [tokenInfosMap, setTokenInfosMap] = useState(new Map());

  useEffect(() => {
    ChromeStorageSyncHandler.getAllDeepLTokens()
      .then((chromeStorageTokenInfos) => {
        const fromChromeStorageTokenInfosMap = new Map();
        for (const tokenInfo of chromeStorageTokenInfos) {
          fromChromeStorageTokenInfosMap.set(tokenInfo.key, tokenInfo);
        }
        setTokenInfosMap(fromChromeStorageTokenInfosMap);
      })
      .catch((error) => {
        console.error("Error when getting all DeepL tokens from Chrome storage:", error);
      });
  }, []);
  return (
    <>
      <TokenInfoCardList />
      <AddNewTokenForm tokenInfosMap={tokenInfosMap} setTokenInfosMap={setTokenInfosMap} />
    </>
  );
}

function TokenManagementAccordion() {
  const [accordionOpen, setAccordionOpen] = useState(false);

  return (
    <div className="setting-card">
      <div className={`setting-card__accordion ${accordionOpen ? "active" : ""}`}>
        <button
          className="setting-card__accordion-header"
          onClick={() => setAccordionOpen(!accordionOpen)}
        >
          <span>Tokens Management</span>
          <span className="setting-card__accordion-icon">&#9660;</span>
        </button>
        <div className="setting-card__accordion-content">
          <div className="setting-card__accordion-content-inner">
            <p className="setting-card__title">
              Manage your DeepL API tokens to enable translation service.
            </p>

            <p className="setting-card__description">
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

            <TokenManagementSection />
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Header />

        <TokenManagementAccordion />
      </div>
    </>
  );
}

export default App;
