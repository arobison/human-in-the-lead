# age test vectors

`testdata/` holds test vectors for the age file format from the C2SP CCTV project: https://github.com/C2SP/CCTV/tree/main/age (directory `age/testdata`). `core/test/age-vectors.test.mjs` runs every file here against `core/lib/store/age.mjs`.

## Source

- Taken from the npm package `cctv-age@0.2.0`, which the CCTV project publishes with the files of `age/testdata` built in.
- Each file was checked byte for byte against `age/testdata` on the repository's `main` branch at commit `b88c4b206254ac543df240097e0f1fcc6a664821`. All matched.
- The files are unchanged.

## Which vectors

The 68 vectors that apply to X25519 recipients in the binary format. Left out:

- 33 that use the ASCII armor, which `age.mjs` does not read.
- 18 that need a hybrid (post-quantum) identity, `AGE-SECRET-KEY-PQ-1...`.
- 24 that need a passphrase (scrypt recipients) and give no X25519 identity.

Each file is a short text header (`expect`, `payload`, `identity`, and others), an empty line, then the age file, compressed with zlib where the header says `compressed: zlib`. The format is described in the CCTV `age/README.md`.

## Licence

The vectors are available under the Zero-Clause BSD licence (0BSD), CC0 1.0, or the Unlicense, at the user's choice. Copyright (c) 2022 The age Authors.

> Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
