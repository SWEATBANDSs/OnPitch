import { Store } from './store.js';
import { Service } from './service.js';
import { createApp } from './app.js';

const store = new Store(process.env.DATA_FILE ?? 'data/db.json');
const svc = new Service(store, {
  slotFeePence: Number(process.env.SLOT_FEE_PENCE ?? 0),
  // Plug SMS/push (e.g. Twilio, web-push) in here. For now deliveries are logged.
  notifier: (playerId, n) => console.log(`[notify ${playerId}] ${n.message}`),
});
const port = Number(process.env.PORT ?? 3000);
createApp(svc, { adminToken: process.env.ADMIN_TOKEN }).listen(port, () => console.log(`OnPitch on http://localhost:${port}`));
