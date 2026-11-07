# Liteify

Makes Spotify lighter on your PC by turning off the eye candy when you don't need it.

![The leaf button in Spotify's player bar, green while lite mode is on](preview.png)

I keep Spotify open on my second monitor while I game, and it kept burning CPU on blur and moving backgrounds nobody
was looking at. Liteify stops that.

## What it does

- Adds a leaf button to the player bar. While it's green (lite mode, on by default), Spotify skips the see-through
  blur, Canvas videos and looping animations.
- Goes lite on its own whenever you click away from Spotify, and hides animated backgrounds like Spicy Lyrics'. Click
  back in and everything is there again instantly.
- Never touches your music or your Discord status.

## Install

Copy it into Spicetify and apply:

```powershell
copy liteify.js "$env:APPDATA\spicetify\Extensions\"
spicetify config extensions liteify.js
spicetify apply
```

## Good to know

Liteify saves CPU, not RAM. Spotify uses about 1 GB and the part an extension can touch is only about 60 MB of that.
If RAM is what you're after, turn off **hardware acceleration** in Spotify's settings (Compatibility). That took mine
from 1.39 GB to 0.99 GB, and lite mode keeps Spotify smooth without the GPU.

## For development

It's all in `liteify.js`.
