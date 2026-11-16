/**
 * Unduh Real-ESRGAN ncnn-vulkan resmi (xinntao, v0.2.5.0) untuk platform build, cek SHA-256,
 * lalu taruh program + model ke resources/upscaler (ikut ke installer lewat extraResources).
 *   node scripts/fetch-upscaler.mts            → platform komputer ini
 *   node scripts/fetch-upscaler.mts darwin     → paksa platform
 *   UPSCALER_ZIP=/path/file.zip node scripts/fetch-upscaler.mts  → pakai zip lokal (offline)
 * Windows: realesrgan-ncnn-vulkan.exe + vcomp140.dll. Mac: binary universal, dipangkas ke arm64 (lipo).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0'
const PKG: Record<string, { file: string; sha256: string; keep: string[] }> = {
  win32: {
    file: 'realesrgan-ncnn-vulkan-20220424-windows.zip',
    sha256: 'abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d',
    keep: ['realesrgan-ncnn-vulkan.exe', 'vcomp140.dll']
  },
  darwin: {
    file: 'realesrgan-ncnn-vulkan-20220424-macos.zip',
    sha256: 'e0ad05580abfeb25f8d8fb55aaf7bedf552c375b5b4d9bd3c8d59764d2cc333a',
    keep: ['realesrgan-ncnn-vulkan']
  },
  linux: {
    file: 'realesrgan-ncnn-vulkan-20220424-ubuntu.zip',
    sha256: 'e5aa6eb131234b87c0c51f82b89390f5e3e642b7b70f2b9bbe95b6a285a40c96',
    keep: ['realesrgan-ncnn-vulkan']
  }
}
/** Model yang dipakai aplikasi (realesrnet-x4plus tidak ada di paket ini). */
const MODELS = ['realesrgan-x4plus', 'realesrgan-x4plus-anime', 'realesr-animevideov3-x2', 'realesr-animevideov3-x3', 'realesr-animevideov3-x4']

const NOTICE = `Upscale AI di Stock Uploader memakai komponen sumber terbuka berikut, tanpa diubah:

1. Real-ESRGAN-ncnn-vulkan (program realesrgan-ncnn-vulkan)
   https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan
   Lisensi: MIT License, Copyright (c) 2021 Xintao Wang

2. Model Real-ESRGAN (folder models/)
   https://github.com/xinntao/Real-ESRGAN
   Lisensi: BSD 3-Clause License, Copyright (c) 2021, Xintao Wang

3. ncnn (pustaka inferensi di dalam program)
   https://github.com/Tencent/ncnn
   Lisensi: BSD 3-Clause License, Copyright (C) 2017 THL A29 Limited, a Tencent company

4. MoltenVK (hanya Mac, di dalam program) — https://github.com/KhronosGroup/MoltenVK — Apache License 2.0
   Microsoft Visual C++ OpenMP runtime vcomp140.dll (hanya Windows) — redistributable dari Microsoft

---------------------------------------------------------------------------
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of
the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---------------------------------------------------------------------------
BSD 3-Clause License

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following
   disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following
   disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote
   products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`

const platform = (process.argv[2] as NodeJS.Platform) || process.platform
const pkg = PKG[platform]
if (!pkg) {
  console.error(`Platform ${platform} tidak didukung.`)
  process.exit(2)
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const out = path.join(root, 'resources', 'upscaler')
const stamp = path.join(out, '.paket')

if (existsSync(stamp) && (await fs.readFile(stamp, 'utf8')).trim() === `${platform} ${pkg.sha256}`) {
  console.log(`Upscaler ${platform} sudah ada di ${out}`)
  process.exit(0)
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'su-esrgan-'))
try {
  const zip = path.join(tmp, pkg.file)
  let buf: Buffer
  if (process.env.UPSCALER_ZIP) {
    // Build offline: pakai zip yang sudah diunduh (sidik tetap dicek).
    buf = await fs.readFile(process.env.UPSCALER_ZIP)
  } else {
    console.log(`Mengunduh ${pkg.file}…`)
    const res = await fetch(`${BASE}/${pkg.file}`)
    if (!res.ok) throw new Error(`Unduhan gagal: kode ${res.status}`)
    buf = Buffer.from(await res.arrayBuffer())
  }
  const sha = createHash('sha256').update(buf).digest('hex')
  if (sha !== pkg.sha256) throw new Error(`SHA-256 tidak cocok untuk ${pkg.file}: ${sha}`)
  await fs.writeFile(zip, buf)

  const ex = path.join(tmp, 'isi')
  await fs.mkdir(ex)
  // Windows 10+ dan Mac punya bsdtar yang bisa membuka zip; Linux pakai unzip.
  if (process.platform === 'linux') execFileSync('unzip', ['-q', zip, '-d', ex], { stdio: 'inherit' })
  else execFileSync('tar', ['-xf', zip, '-C', ex], { stdio: 'inherit' })

  await fs.rm(out, { recursive: true, force: true })
  await fs.mkdir(path.join(out, 'models'), { recursive: true })
  for (const f of pkg.keep) {
    await fs.copyFile(path.join(ex, f), path.join(out, f))
    if (!f.endsWith('.dll')) await fs.chmod(path.join(out, f), 0o755)
  }
  for (const m of MODELS) {
    for (const ext of ['.param', '.bin']) await fs.copyFile(path.join(ex, 'models', m + ext), path.join(out, 'models', m + ext))
  }
  // Mac: aplikasi hanya untuk Apple Silicon, jadi buang bagian Intel (≈ setengah ukuran).
  if (platform === 'darwin' && process.platform === 'darwin') {
    const bin = path.join(out, 'realesrgan-ncnn-vulkan')
    try {
      execFileSync('lipo', [bin, '-thin', 'arm64', '-output', `${bin}.arm64`])
      await fs.rename(`${bin}.arm64`, bin)
      await fs.chmod(bin, 0o755)
    } catch (e) {
      console.warn(`lipo gagal, binary universal dipakai: ${(e as Error).message}`)
    }
  }
  await fs.writeFile(path.join(out, 'LISENSI-UPSCALER.txt'), NOTICE)
  await fs.writeFile(stamp, `${platform} ${pkg.sha256}\n`)
  let total = 0
  for (const f of await fs.readdir(out, { recursive: true })) {
    const st = await fs.stat(path.join(out, String(f)))
    if (st.isFile()) total += st.size
  }
  console.log(`Upscaler ${platform} siap di ${out} (${(total / 1048576).toFixed(1)} MB)`)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
