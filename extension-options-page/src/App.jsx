import { useEffect, useState } from "react";
import { Trash2, RefreshCw, Check } from "lucide-react";
import "./App.css";

const DEEPL_API_TOKEN_REGEX = /^.{20,}:fx$/i;
const DEEPL_FREE_ENDPOINT = import.meta.env.DEV ? "/api/deepl" : "https://api-free.deepl.com/v2";
const DEEPL_PRO_ENDPOINT = import.meta.env.DEV ? "/api/deepl" : "https://api.deepl.com/v2";


/**
 * 
 * @param {string} str  - confidential DeepL token that we want to mask for display
 * @param {number} visibleStart - number of characters to show at the start
 * @param {number} visibleEnd - number of characters to show at the end
 * @returns 
 */
function maskString(str, visibleStart = 3, visibleEnd = 6) {
  if (str.length <= visibleStart + visibleEnd) {
    return str; // don't mask if string is too short
  }
  
  return str.slice(0, visibleStart) + 
         '*'.repeat(str.length - visibleStart - visibleEnd) + 
         str.slice(-visibleEnd);
}

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
 * @typedef {import('../../types.js').DeepLTokenInfoInStorage} DeepLTokenInfoInStorage
 */

/**
 * Sleep for a specified number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ChromeStorageSyncHandler {
  /**
   * @param {DeepLTokenInfoInStorage[]} tokenInfos
   * @returns {Promise[void]}
   */
  static async setAllDeepLTokens(tokenInfos) {
    await chrome.storage.sync.set({ tokenInfos: tokenInfos });
  }

  /**
   * @returns {Promise<DeepLTokenInfoInStorage[]>}
   */
  static async getAllDeepLTokens() {
    const result = await chrome.storage.sync.get("tokenInfos");

    // Check if result is an object
    if (typeof result !== "object" || result === null) {
      return [];
    }

    // Check if result contains the deepLToken field
    if (Object.prototype.hasOwnProperty.call(result, "tokenInfos") === false) {
      return [];
    }

    // Check if result.deepLToken is an array
    if (!Array.isArray(result.tokenInfos)) {
      return [];
    }
    
    return result.tokenInfos;
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

  if (!DEEPL_API_TOKEN_REGEX.test(tokenKey)) {
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
async function queryTokenUsageInfo(tokenKey, tokenType) {
  const url = tokenType === "free" ? `${DEEPL_FREE_ENDPOINT}/usage` : `${DEEPL_PRO_ENDPOINT}/usage`;

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
    console.error("YleDualSubExtension: " + errorMessage);
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

/**
 *
 * @param {Date} date
 * @returns {string} formatted date in en-GB locale string. For example: '01/11/2025, 16:30:35'
 */
function formatDateInEnglishLocale(date) {
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 *
 * @param {string} word
 * @returns {string} For example: "pro" => "Pro"
 */
function capitalizeFirstLetter(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * @param {number} percentage
 * @returns {string} return either "token-card__progress-green", "token-card__progress-yellow" or "token-card_progress-red" based on percentage level
 */
function getProgressBarColorCssClassname(percentage) {
  if (percentage <= 50) {
    return "token-card__progress-green";
  }
  if (percentage <= 75) {
    return "token-card__progress-yellow";
  }
  return "token-card__progress-red";
}

/**
 * @typedef {Object} TokenInfoCardProps
 * @property {DeepLTokenInfoInStorage} tokenInfo - The DeepL token information to display.
 * @property {(tokenKey: string) => void} handleSelectToken - Function to handle token selection.
 * @property {(tokenKey: string) => void} handleCheckUsage - Function to handle when user wants to check new usage time.
 * @property {(tokenKey: string) => void} handleRemoveToken - Function to handle remove token.
 */

/**
 *
 * @param {TokenInfoCardProps} props
 * @returns
 */
function TokenInfoCard(props) {
  const { tokenInfo, handleSelectToken, handleCheckUsage, handleRemoveToken } = props;
  const usagePercentage = ((tokenInfo.characterCount / tokenInfo.characterLimit) * 100).toFixed(1);
  return (
    <div
      key={tokenInfo.key}
      onClick={() => handleSelectToken(tokenInfo.key)}
      className={`token-card ${tokenInfo.selected ? "token-card-selected" : ""}`}
    >
      <div className="token-card__content">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="token-card__header">
            <div
              className={`token-card__checkbox ${
                tokenInfo.selected ? "token-card__checkbox-selected" : ""
              }`}
            >
              {tokenInfo.selected && <Check size={14} className="check-icon" />}
            </div>
            <div className="token-card__details">
              <h3 className="token-card__token-type">
                DeepL {capitalizeFirstLetter(tokenInfo.type)}
              </h3>
              <p className="token-card__token-key">{maskString(tokenInfo.key)}</p>
            </div>
          </div>

          <div className="token-card__usage-container">
            <div className="token-card__usage-stats">
              <span className="token-card__usage-text">
                {formatCharacterUsageNumber(tokenInfo.characterCount)} /{" "}
                {formatCharacterUsageNumber(tokenInfo.characterLimit)} characters
              </span>
              <span className="token-card__usage-percentage">{usagePercentage}%</span>
            </div>

            <div className="token-card__progress-bar">
              <div
                className={`token-card__progress-fill ${getProgressBarColorCssClassname(
                  usagePercentage
                )}`}
                style={{ width: `${Math.min(usagePercentage, 100)}%` }}
              ></div>
            </div>

            <p className="token-card__last-checked-text">
              Last checked: {tokenInfo.lastUsageCheckedAt}
            </p>
          </div>
        </div>

        <div className="token-card__action-buttons">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCheckUsage(tokenInfo.key);
            }}
            className="token-card__button token-card__check-usage-button"
          >
            <RefreshCw size={16} />
            Check Usage
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Are you sure you want to remove this token: ${tokenInfo.key}?`)) {
                handleRemoveToken(tokenInfo.key);
              }
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
 * @typedef {Object} TokenInfoCardListProps
 * @property {DeepLTokenInfoInStorage[]} tokenInfos - An array of DeepL token information.
 * @property {(newTokenInfos: DeepLTokenInfoInStorage[]) => void} setTokenInfos - A function to update the tokenInfos.
 */

/**
 *
 * @param {TokenInfoCardListProps} props
 */
function TokenInfoCardList(props) {
  const { tokenInfos, setTokenInfos } = props;

  /**
   * Handle select token
   * @param {string} tokenKey
   * @return {void}
   */
  function handleSelectToken(tokenKey) {
    const newTokenInfos = structuredClone(tokenInfos);

    for (const tokenInfo of newTokenInfos) {
      if (tokenInfo.key === tokenKey) {
        tokenInfo.selected = true;
      } else {
        tokenInfo.selected = false;
      }
    }
    setTokenInfos(newTokenInfos);
  }

  /**
   * Handle check usage
   * @param {string} tokenKey
   * @return {void}
   */
  async function handleCheckUsage(tokenKey) {
    for (const tokenInfo of tokenInfos) {
      if (tokenInfo.key === tokenKey) {
        try {
          const [isSucceeded, newUsageInfo] = await queryTokenUsageInfo(
            tokenInfo.key,
            tokenInfo.type
          );

          if (!isSucceeded) {
            alert(`Error when checking usage for token ${tokenInfo.key}: ${newUsageInfo}`);
            return;
          }
          tokenInfo.characterCount = newUsageInfo.characterCount;
          tokenInfo.characterLimit = newUsageInfo.characterLimit;
          tokenInfo.lastUsageCheckedAt = formatDateInEnglishLocale(new Date());

          const newTokenInfos = structuredClone(tokenInfos);
          setTokenInfos(newTokenInfos);
        } catch (error) {
          alert(`Error when checking usage for token ${tokenInfo.key}: ${error}`);
          return;
        }
      }
    }
  }

  /**
   * Handle remove token
   * @param {string} tokenKey
   * @return {void}
   */
  function handleRemoveToken(tokenKey) {
    const removedToken = tokenInfos.find((tokenInfo) => tokenInfo.key === tokenKey);
    const wasSelected = removedToken ? removedToken.selected : false;

    const newTokenInfos = tokenInfos.filter((tokenInfo) => tokenInfo.key !== tokenKey);

    if (wasSelected && newTokenInfos.length > 0) {
      const tokenWithMostUsageRemaining = newTokenInfos.reduce((best, current) => {
        const bestCharacterLeftInUsage = best.characterLimit - best.characterCount;
        const currentCharacterLeftInUsage = current.characterLimit - current.characterCount;
        return currentCharacterLeftInUsage > bestCharacterLeftInUsage ? current : best;
      });
      tokenWithMostUsageRemaining.selected = true;
    }

    setTokenInfos(newTokenInfos);
  }

  return (
    <div>
      <p>Here is your list of tokens:</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "18px", marginTop: "20px" }}>
        {tokenInfos.map((tokenInfo) => (
          <TokenInfoCard
            key={tokenInfo.key}
            tokenInfo={tokenInfo}
            handleSelectToken={handleSelectToken}
            handleCheckUsage={handleCheckUsage}
            handleRemoveToken={handleRemoveToken}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * @typedef {Object} AddNewTokenFormProps
 * @property {DeepLTokenInfoInStorage[]} tokenInfos - DeepL tokens info.
 * @property {(newTokenInfos: DeepLTokenInfoInStorage[] ) => void} setTokenInfos - A function to update the tokenInfosMap.
 */

/**
 * @param {AddNewTokenFormProps} props
 * @returns
 */
function AddNewTokenForm(props) {
  const { tokenInfos, setTokenInfos } = props;
  const tokenKeysSet = new Set(tokenInfos.map((tokenInfo) => tokenInfo.key));
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

    if (tokenKeysSet.has(deepLApiTokenKey)) {
      alert(
        "You have already added this token. If the token is not visible, please refresh the page."
      );
      return;
    }

    const [validateSuccess, checkTokenUsageResponse] = await queryTokenUsageInfo(
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
      lastUsageCheckedAt: formatDateInEnglishLocale(new Date()),
      selected: tokenInfos.length === 0,
    };

    const newTokenInfos = [...tokenInfos, deeplTokenInfoInStorage];

    setTokenInfos(newTokenInfos);

    formElement.reset();
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
   * @type {[DeepLTokenInfoInStorage[], (tokenKey: string) => void]}
   */
  const [tokenInfos, setTokenInfos] = useState([]);

  useEffect(() => {
    ChromeStorageSyncHandler.getAllDeepLTokens()
      .then((chromeStorageTokenInfos) => {
        setTokenInfos(chromeStorageTokenInfos);
      })
      .catch((error) => {
        console.error("YleDualSubExtension: Error when getting all DeepL tokens from Chrome storage:", error);
      });
  }, []);

  function setTokenInfosAndPersist(newTokenInfos) {
    setTokenInfos(newTokenInfos);

    ChromeStorageSyncHandler.setAllDeepLTokens(newTokenInfos).catch((error) => {
      console.error("YleDualSubExtension: Error when setting all DeepL tokens to Chrome storage:", error);
    });
  }

  return (
    <>
      <TokenInfoCardList tokenInfos={tokenInfos} setTokenInfos={setTokenInfosAndPersist} />
      <AddNewTokenForm tokenInfos={tokenInfos} setTokenInfos={setTokenInfosAndPersist} />
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
