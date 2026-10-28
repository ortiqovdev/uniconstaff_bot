// Ko'p bosqichli kiritish (forma) holatlari: foydalanuvchi ID → { step, data }
const sessions = new Map();
// Bosqich nomi → { perms, any, handler }
const steps = new Map();

module.exports = {
  get: (id) => sessions.get(id),
  set: (id, step, data = {}) => sessions.set(id, { step, data }),
  clear: (id) => sessions.delete(id),
  /**
   * @param {string} name bosqich nomi
   * @param {{perms?: string[], any?: boolean}} opts any — matndan boshqa xabarlar ham qabul qilinadi
   * @param {(ctx, data) => Promise} handler
   */
  defineStep: (name, opts, handler) => steps.set(name, { ...opts, handler }),
  getStep: (name) => steps.get(name),
};
