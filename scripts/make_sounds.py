#!/usr/bin/env python3
"""Synthesises every sound used by Ludo Pro (dice, move, capture, home, win,
click, coin and a looping background track) and encodes them as MP3.

Usage:  python3 scripts/make_sounds.py
Needs numpy and ffmpeg. Developer: Sanaullah Khoso
"""
import os, subprocess, wave, tempfile
import numpy as np

SR = 22050
OUT = os.path.join(os.path.dirname(__file__), '..', 'www', 'assets', 'sounds')
rng = np.random.default_rng(7)


def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def env(n, attack=0.005, release=0.08, decay=None):
    e = np.ones(n)
    a = max(1, int(SR * attack)); r = max(1, int(SR * release))
    e[:a] = np.linspace(0, 1, a)
    e[-r:] *= np.linspace(1, 0, r)
    if decay:
        e *= np.exp(-np.arange(n) / SR * decay)
    return e


def tone(freq, dur, kind='sine', attack=0.005, release=0.08, decay=None, vol=1.0):
    t = t_axis(dur)
    if kind == 'sine':
        w = np.sin(2 * np.pi * freq * t)
    elif kind == 'tri':
        w = 2 / np.pi * np.arcsin(np.sin(2 * np.pi * freq * t))
    elif kind == 'soft':
        w = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t) + 0.12 * np.sin(6 * np.pi * freq * t)
        w /= 1.5
    else:
        w = np.sign(np.sin(2 * np.pi * freq * t)) * 0.5
    return w * env(len(t), attack, release, decay) * vol


def sweep(f0, f1, dur, decay=4.0, vol=1.0):
    t = t_axis(dur)
    f = f0 + (f1 - f0) * (t / dur)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * env(len(t), 0.004, 0.05, decay) * vol


def noise_burst(dur, decay=60, lp=0.35, vol=1.0):
    n = int(SR * dur)
    x = rng.standard_normal(n)
    # crude low-pass so it sounds like a wooden clack instead of hiss
    y = np.zeros(n); a = lp
    for i in range(1, n):
        y[i] = y[i - 1] + a * (x[i] - y[i - 1])
    return y * np.exp(-np.arange(n) / SR * decay) * vol


def mix(length, parts):
    out = np.zeros(int(SR * length))
    for start, sig in parts:
        i = int(SR * start)
        j = min(len(out), i + len(sig))
        out[i:j] += sig[:j - i]
    return out


def normalise(x, peak=0.85):
    m = np.max(np.abs(x))
    return x / m * peak if m > 0 else x


def write_mp3(name, data, quality=4):
    data = np.clip(data, -1, 1)
    pcm = (data * 32767).astype('<i2')
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        path = f.name
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    dest = os.path.join(OUT, name)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path, '-codec:a', 'libmp3lame',
                    '-q:a', str(quality), dest], check=True)
    os.remove(path)
    print('wrote', name, round(len(data) / SR, 2), 's', os.path.getsize(dest), 'bytes')


def main():
    os.makedirs(OUT, exist_ok=True)

    # dice: a handful of wooden clacks, getting sparser
    times = np.sort(np.concatenate([np.linspace(0.0, 0.45, 9) + rng.uniform(0, 0.03, 9),
                                    [0.55, 0.64, 0.70]]))
    parts = []
    for i, st in enumerate(times):
        amp = 0.9 - 0.04 * i
        f = rng.uniform(380, 720)
        parts.append((st, noise_burst(0.05, 70, 0.5, amp) + tone(f, 0.05, 'sine', 0.001, 0.03, 60, 0.35 * amp)))
    write_mp3('dice.mp3', normalise(mix(0.85, parts)))

    # token step: soft wooden tock
    write_mp3('move.mp3', normalise(mix(0.16, [(0, sweep(620, 360, 0.14, 26, 0.9)),
                                               (0, noise_burst(0.03, 120, 0.6, 0.35))]), 0.8))

    # capture: falling swoop and thud
    write_mp3('capture.mp3', normalise(mix(0.6, [(0, sweep(780, 140, 0.45, 5.0, 0.9)),
                                                 (0.38, tone(110, 0.2, 'sine', 0.002, 0.1, 14, 0.9)),
                                                 (0.38, noise_burst(0.08, 40, 0.3, 0.4))])))

    # token home: rising sparkle
    notes = [659.25, 783.99, 987.77, 1318.5]
    write_mp3('home.mp3', normalise(mix(0.7, [(0.08 * i, tone(f, 0.35, 'soft', 0.004, 0.2, 7, 0.7))
                                              for i, f in enumerate(notes)])))

    # win: short fanfare
    seq = [(0.00, 523.25, 0.18), (0.16, 659.25, 0.18), (0.32, 783.99, 0.18), (0.48, 1046.5, 0.5),
           (0.48, 783.99, 0.5), (0.48, 659.25, 0.5), (1.05, 987.77, 0.14), (1.19, 1046.5, 0.9),
           (1.19, 1318.5, 0.9), (1.19, 784, 0.9)]
    parts = [(s, tone(f, d + 0.25, 'soft', 0.006, 0.25, 2.0, 0.55)) for s, f, d in seq]
    write_mp3('win.mp3', normalise(mix(2.3, parts)))

    # click: very short tick
    write_mp3('click.mp3', normalise(mix(0.07, [(0, tone(1500, 0.05, 'sine', 0.0005, 0.03, 90, 0.8)),
                                                (0, noise_burst(0.015, 200, 0.7, 0.25))]), 0.7))

    # coin: two bright dings
    write_mp3('coin.mp3', normalise(mix(0.55, [(0, tone(1318.5, 0.3, 'soft', 0.002, 0.15, 9, 0.7)),
                                               (0.09, tone(1760, 0.4, 'soft', 0.002, 0.25, 7, 0.7))])))

    # background music: 16 bars, C - Am - F - G, ~108 bpm, designed to loop
    bpm = 108
    beat = 60 / bpm
    bar = 4 * beat
    chords = [  # root (bass), chord tones
        (65.41, [261.63, 329.63, 392.00]),
        (110.00, [220.00, 261.63, 329.63]),
        (87.31, [220.00, 261.63, 349.23]),
        (98.00, [196.00, 246.94, 293.66]),
    ]
    penta = {0: [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5],
             1: [440.0, 523.25, 587.33, 659.25, 783.99, 880.0],
             2: [523.25, 587.33, 698.46, 783.99, 880.0, 1046.5],
             3: [493.88, 587.33, 659.25, 783.99, 987.77, 1174.7]}
    total = 16 * bar
    parts = []
    mrng = np.random.default_rng(11)
    for b in range(16):
        ci = b % 4
        root, tones = chords[ci]
        t0 = b * bar
        # pad
        for f in tones:
            parts.append((t0, tone(f, bar + 0.1, 'sine', 0.35, 0.5, None, 0.10)))
        # bass: root on beats 1 and 3, fifth on the &s
        for k, mult in [(0, 1), (1.5, 1.5), (2, 1), (3.5, 2)]:
            parts.append((t0 + k * beat, tone(root * mult, beat * 0.9, 'tri', 0.004, 0.12, 3.5, 0.34)))
        # arpeggio, soft plucks
        arp = [tones[0], tones[1], tones[2], tones[1]] * 2
        for k, f in enumerate(arp):
            parts.append((t0 + k * beat / 2, tone(f * 2, beat * 0.5, 'soft', 0.003, 0.1, 6, 0.10)))
        # lead melody on eighth notes with rests
        lead = penta[ci]
        pos = mrng.integers(0, len(lead))
        for k in range(8):
            if mrng.random() < 0.28:
                continue
            pos = int(np.clip(pos + mrng.integers(-2, 3), 0, len(lead) - 1))
            if k % 4 == 0:
                f = tones[mrng.integers(0, 3)] * 2
            else:
                f = lead[pos]
            parts.append((t0 + k * beat / 2, tone(f, beat * 0.55, 'soft', 0.01, 0.15, 4.5, 0.17)))
    music = mix(total + 0.2, parts)[:int(SR * total)]
    # fade the very ends so the loop point has no click
    n = int(SR * 0.05)
    music[:n] *= np.linspace(0, 1, n)
    music[-n:] *= np.linspace(1, 0, n)
    write_mp3('music.mp3', normalise(music, 0.7), quality=6)


if __name__ == '__main__':
    main()
