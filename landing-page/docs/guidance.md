# Guidance

This page provides step-by-step instructions on how to set up and use the extension.

## Installation

1. Go to [YLE Areena Dual Sub on Chrome Extension Webstore](https://chromewebstore.google.com/detail/yle-areena-dual-subtitles/olmapcjpickcoabnjleheppoignffpdd)
2. Click "Add to Chrome".
3. Open Extension popup and click `Settings` button.

   - <img src={require('@site/static/img/extension-popup-page.png').default} alt="Extension popup page" style={{maxWidth: '75%', borderRadius: '8px', border: '1px solid #404040'}} />

4. Add your `DeepL Translation Key`.

   - <img src={require('@site/static/img/add-new-deepl-translation-key.png').default} alt="Add new DeepL translation key" style={{maxWidth: '75%', borderRadius: '8px', border: '1px solid #404040'}} />

5. (Optional) Select your preferred translation language from the dropdown (default is English). You can choose from Vietnamese, Japanese, Spanish, and all other languages supported by DeepL.

6. Open [YLE Areena TV](https://areena.yle.fi/tv) and enjoy.

7. Remember to turn on subtitle `Tekstitykset.Ohjelmatekstitys` and toggle on `Dual Sub` switch on the bottom bar.

Here is the [extension demo video](https://www.youtube.com/watch?v=O3B7BCvd99Y) if you want to see the whole usage flow.

## Setting Up Your Translation Key

### ℹ️ What is a translation key? How do I get one?

#### 📖 What is a translation key (API key)?

A translation key is like a password that allows this extension to use DeepL's translation service. It's completely free for basic usage!

⚠️ **Important:** You'll need a credit card to sign up for DeepL's API, but **the free tier is 100% free** - you won't be charged unless you manually upgrade to a paid plan.

#### 🤔 Why do I need to set this up?

You might wonder: "Other dual-sub extensions like Language Reactor, Trancy, and InterSub work instantly—why not this one?"

Here's the truth: Free services either use low-quality translation APIs, run at a loss (subsidized by premium users), or monetize your data. 💰

**I built this extension differently because I believe you deserve:**

- ✨ **Best-in-class translations** – DeepL provides high-quality translations to 30+ languages including English, Vietnamese, Japanese, and more
- 🔒 **Complete privacy** – No data collection, no ads, no tracking
- ♻️ **Sustainability** – No active maintenance burden on my end
- 🆓 **Truly free** – DeepL's free tier gives you 500,000 characters/month!

Yes, it takes 5-10 minutes for one-time setup, but you get premium quality without compromise. Worth it? I think so! 😊

#### 🔑 How to get your free translation key (one-time setup):

**📺 Video walkthrough (recommended):** [Watch 1 min tutorial from Youtube](https://www.youtube.com/watch?v=VgpxUH7SbSY)

**📝 Step-by-step instructions:**

1. **Sign up for a free DeepL account**

   Visit [DeepL Account Signup](https://www.deepl.com/en/your-account) and create your account

2. **Select your DeepL API plan**

   Go to [DeepL Developer Page](https://www.deepl.com/en/pro#developer), look for **"Find your perfect plan"**, then click the **"DeepL API"** tab. Select either Free or Pro plan depending on your needs.

   <img src={require('@site/static/img/find_your_perfect_plan.png').default} alt="Find your perfect plan section" style={{maxWidth: '75%', borderRadius: '8px', border: '1px solid #404040'}} />

3. **Create your free subscription**

   Click **"Sign up for free"** under the DeepL API Free plan (for Pro users, click **"Buy now"**).

   💳 You'll be asked for a credit card, but it won't be charged for the free plan

4. **Create your API key**

   After the subscription has been made, go to [DeepL Key Page](https://www.deepl.com/en/your-account/keys). Click the **"Create Key"** button and give it a name (e.g., "YLE Dualsub translation key")

   <img src={require('@site/static/img/create_your_key.png').default} alt="Create you key" style={{maxWidth: '75%', borderRadius: '8px', border: '1px solid #404040'}} />

5. **Copy your key**

   Your API key will look like this:

   - Free tier: `fcb8779e-4837-4e2f-99ef-1ac7255d2ed2:fx` (ends with :fx)
   - Pro tier: `fcb8779e-4837-4e2f-99ef-1ac7255d2ed2` (no :fx suffix)

6. **Paste it in the extension**

   Copy the entire key and paste it in the extension's options page, select your account type (Free/Pro), and click "Add new translation key"

🎉 That's it! Your extension is now ready to provide high-quality translations.

📚 Need more help? View the [official DeepL guide](https://support.deepl.com/hc/en-us/articles/360020695820-API-key-for-DeepL-API)

### 💡 Pro Tip: Maximizing Your Free Usage

Since DeepL Pro uses a pay-as-you-go model, it's recommended to use multiple DeepL API Free keys first. You can add up to 5 keys to this extension for extended usage before considering the Pro tier!

For example, in 2025, 500,000 characters/month limit in DeepL Free will cost you 15 euro in DeepL Pro subscription.

Read more about DeepL pricing in the [official DeepL developer page](https://www.deepl.com/pro#developer).
