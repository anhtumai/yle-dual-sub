# YLE Dual Sub Extension

A Chrome extension that adds dual subtitles to YLE Areena videos, helping you learn Finnish through immersion by displaying Finnish subtitles alongside translations in your preferred language.

## What It Does

This extension integrates with YLE Areena's video player to show dual subtitles - Finnish on top, your chosen translation below. As you watch Finnish TV shows, movies, and documentaries, you can follow along in both languages simultaneously.

Check [project video demo](https://www.youtube.com/watch?v=O3B7BCvd99Y)

## Key Features

- **Dual Subtitle Display** - Finnish + translated subtitles shown side-by-side
- **Multiple Language Support** - Translate to English, Vietnamese, Japanese, Spanish, or any of the 37 languages supported by DeepL
- **Smart Caching** - Translations stored locally for 30 days; rewatching videos uses zero API calls
- **Multi-Token Support** - Add up to 5 DeepL API tokens with visual usage tracking
- **One-Click Toggle** - Enable/disable dual subtitles directly in the video player
- **Shadowing Tools** - Rewind/forward 1 second buttons + keyboard shortcuts (`,` and `.` keys) for pronunciation practice
- **Privacy-First** - All data stays in your browser; no tracking, no ads

## Why I Built This

I've passed the YKI test (all 4 skills) and completed Suomen Mestari 4. But until then, my skill is far from enough to hold a deep and meaningful conversation in Finnish. That is because, the spoken language, with many slangs and its own rules, is different from what we learned in the grammar books. Finnish people speak perfect English so it is not easy to practice in the real life, plus that my level is not enough to discuss complicated topics.

This extension is my plan to reach the next level, where you can expose to authentic spoken Finnish in the safe environment, where you dont have pressure to speak. You have access to all contents in YLE Areena to immerse not only in the language, but also in the culture and history. You can even use it to watch news, even president speeches regardless of your Finnish level.

## How It Works

1. You watch videos on YLE Areena with Finnish subtitles enabled
2. The extension intercepts Finnish subtitle text
3. Text is translated via DeepL API using your personal API key
4. Translations are cached locally in IndexedDB for 30 days
5. Both Finnish and translated subtitles display in the video player

## Installation

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/yle-areena-dual-subtitles/olmapcjpickcoabnjleheppoignffpdd)

See the [documentation site](https://anhtumai.github.io/yle-dual-sub/) for setup instructions and usage guide.

## Technology Stack

- **Manifest V3** Chrome Extension
- **DeepL API** for high-quality translations
- **IndexedDB** for local caching with multi-language support
- **Chrome Storage Sync** for cross-device settings persistence
- **React** for the settings UI

## Development

```bash
# Install dependencies
npm install

# Run linting check
npm run lint

# Run type checking
npm run type-check

# Build settings page
cd extension-options-page
npm install
npm run build
```

## Architecture

## License

GPL v3 (GNU General Public License v3)
