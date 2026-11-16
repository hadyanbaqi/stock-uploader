// Mac: beri tanda tangan ad-hoc (gratis, tanpa akun Apple Developer) setelah aplikasi dirakit.
// Tanpa tanda tangan, macOS di chip M menyebut aplikasi yang di-download "rusak" dan menolak membukanya.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // Program upscale ada di Resources (bukan lokasi kode standar), jadi --deep tidak menandatanganinya.
  // Di Apple Silicon program tanpa tanda tangan langsung dimatikan, jadi tanda tangani dulu sendiri.
  const upscaler = path.join(app, 'Contents', 'Resources', 'upscaler', 'realesrgan-ncnn-vulkan')
  if (require('node:fs').existsSync(upscaler)) {
    execFileSync('codesign', ['--force', '--sign', '-', upscaler], { stdio: 'inherit' })
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' })
}
