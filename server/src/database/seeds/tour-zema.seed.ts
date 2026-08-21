/**
 * @file tour-zema.seed.ts
 * @description The "ZeMA Besucherrundgang" tour route (TASK-213): the German
 *              demo tour through the sim warehouse — STAGING → AISLE-1 →
 *              DOCK-1 → CHARGING-A, with the apple pick-and-place as the
 *              workstation demo. Run with `npm run seed:tour`; idempotent by
 *              route name, so re-running it never duplicates the route.
 *
 *              EVERY fact in here is checkable against this repository. Nothing
 *              about ZeMA as an institution (age, staff, funding) is stored in
 *              this codebase, so nothing about it is asserted: an invented
 *              number spoken to a visitor is exactly the failure host mode is
 *              built to avoid, and the operator adds site facts in the editor.
 * @feature tour
 */

import { tourService, type TourRouteInputBody } from '../../services/TourService.js';
import { tourRepository } from '../../repositories/TourRepository.js';
import type { TourRouteRecord } from '../../repositories/TourRepository.js';

/** Name the seed is idempotent on. */
export const ZEMA_TOUR_ROUTE_NAME = 'ZeMA Besucherrundgang';

/**
 * Place ids come from
 * `robot-agent/hardware/sim_evaluator/places/places.warehouse.json` — the same
 * graph `goto` resolves against in the warehouse scene, so every stop is
 * reachable without editing anything.
 */
export const ZEMA_TOUR_ROUTE: TourRouteInputBody = {
  name: ZEMA_TOUR_ROUTE_NAME,
  // Not bound to a robot: the demo runs on whichever G1 (sim or bench) the
  // operator starts it on.
  robotId: null,
  twinId: null,
  language: 'de',
  greetingPlaceId: 'STAGING',
  greeting:
    'Hallo, schön dass Sie da sind. Ich bin ein Unitree G1 und arbeite hier als Roboter im ZeMA.',
  offer: 'Wenn Sie möchten, zeige ich Ihnen in ein paar Minuten, was ich hier mache. Sagen Sie einfach ja.',
  farewell: 'Danke für Ihren Besuch. Ich gehe zurück zu meinem Platz und warte auf den nächsten Gast.',
  // Facts true of this repository and of the robot in front of the visitor.
  siteCard: [
    'Ich bin ein Unitree G1, ein humanoider Roboter mit zwei Beinen und zwei Armen.',
    'Meine Hände sind Dex3-1 Hände; mit ihnen komme ich auf 43 Gelenke.',
    'Meine Software heißt NeoDEM und deckt den ganzen Weg ab: Daten sammeln, trainieren, ausrollen, bewerten, betreiben.',
    'Spracherkennung, Sprachmodell und Sprachausgabe laufen auf dem Rechner am Roboter, nicht in einer Cloud.',
    'Ich nehme kein Video und kein Audio auf und speichere keine Gesichter.',
    'Was ich Ihnen erzähle, hat ein Mensch vorher aufgeschrieben. Wenn ich etwas nicht weiß, sage ich das.',
  ],
  stops: [
    {
      id: 'stop-1-staging',
      placeId: 'STAGING',
      headline: 'Startplatz',
      talkTrack:
        'Hier ist mein Startplatz. Von hier aus laufe ich los und hierher komme ich zurück. ' +
        'Ich fahre nicht auf Schienen und ich folge keiner Linie: ich habe eine Karte von dieser Halle und plane meinen Weg darauf selbst. ' +
        'Gehen Sie einfach hinter mir her, dann zeige ich Ihnen drei Stationen.',
      facts: [
        'Ich laufe auf zwei Beinen und plane meinen Weg auf einer Karte, die ich selbst aufgenommen habe.',
        'Die Karte entsteht aus meinen eigenen Sensordaten und kann als Datei exportiert werden.',
        'Orte wie Startplatz, Gang oder Ladestation haben Namen; ich kann einen Ort ansteuern, den ich noch nie gesehen habe.',
        'Bevor ich einen Schritt mache, prüfe ich Sperrflächen und den Abstand nach vorn.',
      ],
      dwellS: 12,
      askToContinue: true,
    },
    {
      id: 'stop-2-aisle-1',
      placeId: 'AISLE-1',
      headline: 'Meine Arbeitsstation',
      // The sentence from the use case, verbatim.
      talkTrack:
        'Hier ist meine Arbeitsstation — ich hebe einen Apfel auf einen Teller, mit einem VLA-Modell, das wir selbst trainiert haben. ' +
        'VLA heißt Vision-Language-Action: das Modell sieht das Bild meiner Kamera, hört den Auftrag als Satz und gibt direkt die Bewegung meiner Arme aus. ' +
        'Es wurde nicht programmiert, sondern an vorgeführten Griffen trainiert.',
      facts: [
        'Der Auftrag an das Modell ist ein Satz: "move the apple to the plate".',
        'Das Modell bekommt das Bild meiner Kopfkamera und meine Gelenkstellungen und gibt Gelenkbewegungen zurück.',
        'Es wurde an vorgeführten Griffen trainiert, nicht Schritt für Schritt programmiert.',
        'Das Modell rechnet in Blöcken von 16 Schritten; nach 8 ausgeführten Schritten schaue ich neu hin.',
        'Trainieren, Ausrollen und Bewerten dieses Modells laufen in derselben Plattform, die auch diesen Rundgang steuert.',
      ],
      demo: {
        // `skillId` is a SkillDefinition id. In the sim the demo runs in
        // `narrate` mode (the warehouse scene walks, the apple scene is
        // fixed-base — they are not the same MuJoCo process), so this id is
        // spoken about rather than executed until an operator points it at the
        // skill their bench actually serves.
        skillId: 'g1_apple_pnp',
        skillName: 'Apfel auf den Teller',
        expectSeconds: 45,
      },
      dwellS: 20,
      askToContinue: true,
    },
    {
      id: 'stop-3-dock-1',
      placeId: 'DOCK-1',
      headline: 'Tor 1',
      talkTrack:
        'Das ist Tor 1. Nachts laufe ich hier eine feste Runde ab, fotografiere die gleichen Stellen wie beim letzten Mal ' +
        'und melde, was anders aussieht als sonst. Ein Mensch entscheidet dann, ob das wirklich etwas ist. ' +
        'Wenn dabei eine Person im Bild ist, wird das Foto nicht gespeichert.',
      facts: [
        'Die Nachtrunde ist eine gespeicherte Route aus Kontrollpunkten und läuft nach Zeitplan.',
        'An jedem Kontrollpunkt vergleiche ich das aktuelle Bild mit einem früheren Bild derselben Stelle.',
        'Auffälligkeiten gehen als Meldung an einen Menschen; ich entscheide nichts allein.',
        'Ist eine Person im Bild, wird das Foto verworfen und nicht gespeichert.',
      ],
      dwellS: 12,
      askToContinue: true,
    },
    {
      id: 'stop-4-charging-a',
      placeId: 'CHARGING-A',
      headline: 'Ladestation',
      talkTrack:
        'Hier lade ich. Wenn mein Akku unter zwanzig Prozent fällt, fange ich nichts mehr von mir aus an. ' +
        'Und wenn Sie "stopp" sagen, halte ich sofort an — das geht immer, auch mitten im Satz. ' +
        'Damit sind wir durch. Haben Sie noch eine Frage?',
      facts: [
        'Unter zwanzig Prozent Akku starte ich nichts mehr von mir aus.',
        'Das Wort "stopp" hält mich sofort an, ohne Umweg über ein Sprachmodell.',
        'Auch ein Notaus am Gerät hält mich an; danach muss ein Mensch mich wieder freigeben.',
        'Ich halte Abstand nach vorn und bleibe stehen, wenn jemand zu nah vor mir steht.',
      ],
      dwellS: 20,
      askToContinue: false,
    },
  ],
  enabled: true,
  // Off by default: a robot that walks up to strangers on its own is a decision
  // the site makes, and the demo turns it on deliberately before filming.
  autoGreet: false,
};

/**
 * Create the demo route if a route of that name does not exist yet. Returns
 * the route either way. Goes through {@link tourService.createRoute} on
 * purpose: the seed is then validated by exactly the same rules the editor is,
 * so a talk track that grew past the cap fails here rather than in front of a
 * visitor.
 */
export async function seedZemaTourRoute(): Promise<TourRouteRecord> {
  const existing = (await tourRepository.listRoutes()).find((r) => r.name === ZEMA_TOUR_ROUTE_NAME);
  if (existing) return existing;
  return tourService.createRoute(ZEMA_TOUR_ROUTE);
}

// Run directly (`npm run seed:tour`), not on server boot: this is demo content
// for the ZeMA showing, not something every deployment should grow a route for.
if (process.argv[1] && process.argv[1].endsWith('tour-zema.seed.ts')) {
  seedZemaTourRoute()
    .then((route) => {
      console.log(`OK: ${route.id} ${route.name} (${route.stops.length} stops, ${route.language})`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
