// Titel-Auth ueberspringen: nur User-Token + Device-Token -> XSTS -> Minecraft-Token.
const fs = require('fs');
const { Authflow, Titles } = require('prismarine-auth');

(async () => {
  const flow = new Authflow(process.env.MC_USER || '', './auth', {
    flow: 'live', authTitle: Titles.MinecraftJava, deviceType: 'Linux'
  }, (d) => console.log('DEVICECODE ' + (d && d.user_code)));

  flow.doTitleAuth = false; // kein title/authenticate mehr

  try {
    const r = await flow.getMinecraftJavaToken({ fetchProfile: true, fetchEntitlements: true });
    const prof = r.profile || {};
    fs.writeFileSync('./profile.json', JSON.stringify(prof, null, 2));
    fs.writeFileSync('./entitlements.json', JSON.stringify(r.entitlements || {}, null, 2));
    console.log('MC_OK name=' + prof.name + ' id=' + prof.id);
    const ent = r.entitlements || {};
    console.log('ENTITLEMENTS ' + JSON.stringify(Object.keys(ent)));
    if (Array.isArray(ent.items)) console.log('ITEMS ' + ent.items.map(i => i.name).join(','));
    process.exit(0);
  } catch (e) {
    console.log('MC_ERROR ' + JSON.stringify(e && (e.message || e)).slice(0, 400));
    process.exit(1);
  }
})();
