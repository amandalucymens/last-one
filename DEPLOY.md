# Hosting Last One

Notes for running and hosting the game. For what the game is, see README.md.

## What's in here

| File | What it does |
| --- | --- |
| `public/index.html` | The whole game page: home screen, practice mode, lobby, table, voice chat |
| `server.js` | Runs each game, keeps hands hidden, plays the computer players, passes voice-chat messages between players |
| `engine.js` | The card rules (the same rules the page uses for practice mode) |
| `rules.js` | Rule Roulette twists, plus optional AI-made twists |
| `render.yaml` | Settings for hosting on Render |

## Put it online (free, no coding)

1. **Put the code on GitHub.** Sign in at github.com, click **New repository**, name it `last-one`, and create it. On the empty repository page, click **uploading an existing file**, then drag in everything from this folder: `public`, `engine.js`, `rules.js`, `server.js`, `package.json`, `package-lock.json`, `render.yaml`, `README.md`. Click **Commit changes**.
2. **Create the website on Render.** Go to render.com and sign up with your GitHub account. Click **New +**, then **Web Service**, and pick your `last-one` repository. Use these settings:
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
3. Click **Create Web Service** and wait 2-3 minutes. Render gives you an address like `https://last-one-abcd.onrender.com`.
4. **Play.** Open that address, choose **Play with friends**, type your name and tap **Create a game link**. Copy the link and send it to your friends.

When you change the code later, upload the changed files to GitHub again and Render redeploys automatically.

## Good to know

- **The free plan sleeps** after 15 minutes without visitors. The first person to open the link afterwards waits about a minute while it wakes up.
- **Games live in the server's memory.** Redeploying or restarting ends games in progress. Links keep working, and the table starts fresh.
- **Voice chat** needs the secure `https://` address, which Render gives you. Each player taps the mic to talk; everyone can hear without turning their own mic on.
- **If someone can't hear or be heard** on a strict network (some office or school Wi-Fi, some mobile carriers), add a relay server. Get free relay details from a provider such as Metered (metered.ca) or Cloudflare, then in Render open **Environment** and add:
  - `TURN_URLS`: the relay addresses, separated by commas
  - `TURN_USERNAME`: the username
  - `TURN_CREDENTIAL`: the password
- **AI-made Rule Roulette twists (optional):** add `OPENAI_API_KEY` under **Environment**. You can also set `OPENAI_MODEL`. Without a key, the wheel picks from 12 built-in twists.
- **Up to 6 players** per table, including computer players. Someone who joins mid-round is dealt in next round. A player who drops out has their turns played for them after 15 seconds, and can rejoin from the same link.

## Run it on your own computer

You need Node.js 20 or newer.

```
npm install
npm start
```

Then open http://localhost:3000.
