# Hexify

Hex's Spotify extensions: little add-ons I made for my own Spotify. They run through [Spicetify](https://spicetify.app) on the Windows desktop
app.

I built these for myself, around how I listen: lots of local files (mostly unreleased Juice WRLD), a Discord status I
care about, and a PC I'd like Spotify to go easy on. You're welcome to look around or borrow ideas, but they're not
made for general use and I don't support them. They're tested on Spotify 1.3.8 with Spicetify 2.46.4, and a Spotify
update can break any of them.

## What's in here

- **[Liteify](Liteify/README.md)** makes Spotify lighter. A leaf button turns off the blur and animations, and it
  does the same by itself whenever Spotify isn't the window you're using.
- **[Hexed](Hexed/README.md)** is my own Spotify Wrapped that I can open any day: real play counts, any date range,
  and my full listening history imported from Spotify.
- **[VaultBridge](VaultBridge/README.md)** works with my other app, 999 Vault. Songs it sends to Spotify land at the
  top of a playlist, and every local song gets lyrics.
- **[LocalPresence](LocalPresence/README.md)** gives local files a proper Discord status with the real cover,
  instead of Spotify's grey "?".

`tools/` has the scripts I use while building these (running code inside Spotify, catching errors, screenshots).

## Installing

You need [Spicetify](https://spicetify.app) installed first. Each extension's README has its own install steps, so
you can take just the ones you want. `spicetify apply` restarts Spotify, so your music stops for a few seconds.
