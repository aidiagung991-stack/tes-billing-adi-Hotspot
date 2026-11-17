import readline from 'node:readline';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const BCRYPT_COST_FACTOR = 12;
const MIN_PASSWORD_LENGTH = 8;

async function promptHidden(promptText: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // Mendukung input non-interaktif melalui stdin lokal (mis. pipe lokal pada Ubuntu)
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }

  return await new Promise<string>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    const stdin = process.stdin;
    const stdout = process.stdout;
    let muted = false;

    const origWrite = (rl as any)._writeToOutput;
    (rl as any)._writeToOutput = function (stringToWrite: string) {
      if (muted) {
        if (stringToWrite.includes('\n') || stringToWrite.includes('\r')) {
          stdout.write('\n');
        }
        return;
      }
      origWrite.call(rl, stringToWrite);
    };

    stdout.write(promptText);
    muted = true;
    stdin.resume();

    rl.question('', (answer) => {
      muted = false;
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  console.log('================================================================');
  console.log(' Adi_Hotspot Billing - Generator Hash Password Admin Lokal');
  console.log('================================================================');
  console.log('Script ini berjalan 100% lokal di server Anda dan tidak mengirim data ke mana pun.\n');

  const password = await promptHidden('Masukkan password admin baru (min. 8 karakter, disarankan >= 12): ');
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    console.error(`\n[GAGAL] Password minimal ${MIN_PASSWORD_LENGTH} karakter.`);
    process.exit(1);
  }

  if (process.stdin.isTTY) {
    const confirm = await promptHidden('Ulangi password admin baru: ');
    if (password !== confirm) {
      console.error('\n[GAGAL] Konfirmasi password tidak cocok.');
      process.exit(1);
    }
  }

  const hash = await bcrypt.hash(password, BCRYPT_COST_FACTOR);
  const suggestedSessionSecret = crypto.randomBytes(48).toString('hex');

  console.log('\n[BERHASIL] Salin nilai berikut ke file .env server Ubuntu Anda:');
  console.log('----------------------------------------------------------------');
  console.log(`ADMIN_PASSWORD_HASH='${hash}'`);
  console.log(`SESSION_SECRET="${suggestedSessionSecret}"`);
  console.log('----------------------------------------------------------------');
  console.log('Catatan: Gunakan tanda kutip tunggal (\'...\') untuk ADMIN_PASSWORD_HASH agar karakter $ tidak diinterpretasikan shell.');
}

main().catch((err) => {
  console.error('[ERROR] Gagal menghasilkan hash password:', err?.message || err);
  process.exit(1);
});
