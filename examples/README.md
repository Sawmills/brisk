# Examples

Each folder is a complete Brisk site. Deploy any of them:

```sh
brisk deploy examples/guestbook
brisk deploy examples/cursors
```

| Example                        | What it shows                                                            |
| ------------------------------ | ------------------------------------------------------------------------ |
| [`guestbook`](guestbook)       | `brisk.db` collections, realtime `subscribe`, `brisk.me()` identity      |
| [`cursors`](cursors)           | `brisk.channel` multiplayer: live cursors with presence                  |
| [`flow-field`](flow-field)     | ambient particle flow field on canvas, hand-rolled noise                 |
| [`drum-machine`](drum-machine) | Web Audio synthesis: 16-step sequencer with a lookahead scheduler        |
| [`fractal`](fractal)           | smooth-colored Mandelbrot explorer, coarse-to-fine rendering             |
| [`2048`](2048)                 | the classic game with real slide/merge animations                        |
| [`palette`](palette)           | oklch ramp studio with click-to-copy and CSS export                      |
| [`room`](room)                 | Three.js isometric diorama: orbit controls, soft shadows, ambient motion |

The bottom six are fully static — no `brisk.*` calls — so they also work on
public instances where the backend APIs require sign-in. (`room` vendors
Three.js into its own folder; the rest are single dependency-free files.)
