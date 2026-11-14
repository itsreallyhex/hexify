# Hexify

Hex's Spotify extensions: little add-ons I made for my own Spotify. They run through [Spicetify](https://spicetify.app) on the Windows desktop
app.

I built these for myself, around how I listen: lots of local files (mostly unreleased Juice WRLD), a Discord status I
care about, and a PC I'd like Spotify to go easy on. You're free to use them, change them or borrow ideas, but
updates follow what I want, not requests. They're tested on Spotify 1.3.9 with Spicetify 2.46.7, and a Spotify update
can break any of them.

## What's in here

- **[Liteify](Liteify/README.md)** makes Spotify lighter. A leaf button turns off the blur and animations, and it
  does the same by itself once Spotify has been out of sight for a few minutes.
- **[Hexglass](Hexglass/README.md)** is my own Spotify look: the song's cover glows behind glass panels, and a small
  app puts the song and its lyrics on my desktop.
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

## License

MIT. See [LICENSE](LICENSE).
