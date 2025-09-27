# YLE Dual Sub

This is a Chrome extension to provide dual sub for content on YLE Areena.
There will be original Finnish sub, and translated English sub below, like this:

![Extension Demo](/assets/extension_demo.png)

This project is inspired by Language Reactor: https://www.languagereactor.com

## Motivation

For anyone who has spent efforts into learning Finnish, you will know that this language is the opposite of easy 😣💔😤.
Especially, to make things even more 'interesting' 🙄😩, there are a huge difference in written language and
spoken language 📚🗣️. Different grammars, different words (a lot of slanges) 🤯😵‍💫🫠.
It is very common that people have learned written language from grammar book 📖😴,
but cannot communicate at all 😭🚫💬. This language simply has a lot of spectrums 🌈🎭,
and no grammar books can hold your hand through all of that 📚❌🤝.

I have completed a large part of grammar book 📚✅, I have prepared for the B1 exam 📝💪, but I feel I need to do
a lot more than that 😤🔥💯. This project is a 'desperate' measure for me to emerge into the language 🌊🏊‍♂️🚀, get used to the native accents 🎧👂🇫🇮. If I need to master this language in years 📅⏰💎, let it be the most painless progress ever 🌟✨💫,
not by learning grammar books, but by watching movies 🎬🍿❤️🎉🙌!

In Finland, YLE Areena content is free 🇫🇮✨, DeepL (a top-tier translation service for Finnish -> English) API is also free 🎉. So why not take advantage of these? 💡

💪💪💪

## Set up

Note: This project is still a work in progress, so the setup is a bit manually.
(It works on my machine already so I don't have motivation to give it a proper UI and publish it to Chrome Extensions Store. But if there are enough people interested then I will change my mind)

1. Git clone this project

```bash
git clone https://github.com/anhtumai/yle-dual-sub.git
```

2. Get your DeepL API token key, based on this guide:
   https://support.deepl.com/hc/en-us/articles/360020695820-API-key-for-DeepL-API

3. Add config.js file the same folder

The content of config.js should look like this:

```js
globalThis.deeplToken = "abcd123456789:fx";
```

Replace `abcd123456789:fx` with your actual DeepL token value.
(For the time being, the software only works with DeepL free token, without any subscription).

4. Load the extension with chrome extension developer mode.

![Load Extension Guide](/assets/load_extension_guide.png)

- Go to: chrome://extensions/ with your browser.

- Toggle on `Developer Mode` on the top right side.

- Click `Load unpacked` button on the top left and select this folder

In the end, you should see `YLE Areena Dual Subtitles Extension 1.0` in your extensions.

5. Open any contents (movies, series) on Yle Areena and enjoy.

__NOTE__: This Project contains __ZERO dependencies__ so absolutely no possibilies of being a target of chain attacks. Totally safe to install and setup.
