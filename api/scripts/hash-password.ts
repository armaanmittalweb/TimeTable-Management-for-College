// Usage: npm run hash-password -- '<password>'   (prints a users.password_hash value)
import { hashPassword } from '../src/password.ts';

const password = process.argv[2];
if (!password) {
  console.error('usage: npm run hash-password -- <password>');
  process.exit(1);
}
console.log(await hashPassword(password));
