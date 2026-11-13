# Across the Lake

A vanilla JavaScript port of the stone-skipping game by The Steinbachers. Press Space, tap, click, or use a gamepad button to throw the stone. Press again as it touches the water to skip. After the results slide in, press again for another throw.

## Run locally

Serve this directory with any static HTTP server. No build or package install is needed.

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/>.

## Original game

Game by Stephan Steinbach, art by Morgan McGuire, physics by Forrester Cole, and sound by Steve LaVietes. This port uses the [Across the Lake 1.1 source and assets in factory797/quadplay](https://github.com/factory797/quadplay/tree/14a614c476bbbce3fbada724f662c2e4c7647e44/games/across_the_lake).

The page opens on the game’s title screen. Music starts when the browser permits audio, usually after the first click, tap, or key press. See [LICENSE.md](LICENSE.md) for attribution and licenses.
