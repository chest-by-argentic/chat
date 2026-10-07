// The emoji the picker and the composer's ":" offer, with the words they
// are found by in English and in French (the first English word is the
// shortcode: ":thumbsup:"). Any other emoji typed or pasted works the same:
// this list only helps find them.

type Entry = [emoji: string, en: string, fr: string];

// In groups, the order the picker shows them in.
const groups: { key: string; list: Entry[] }[] = [
  { key: "smileys", list: [
    ["😀", "grinning smile happy", "sourire content"], ["😃", "smiley happy", "sourire joie"], ["😄", "smile happy joy", "sourire rire"],
    ["😁", "grin teeth", "sourire dents"], ["😆", "laughing lol", "rire mdr"], ["😅", "sweat_smile relief", "soulagement sueur"],
    ["😂", "joy tears laugh", "larmes rire mdr"], ["🤣", "rofl rolling laugh", "mort de rire"], ["🙂", "slight_smile", "léger sourire"],
    ["🙃", "upside_down", "à l'envers"], ["😉", "wink", "clin d'œil"], ["😊", "blush happy", "rougir heureux"],
    ["😇", "innocent halo", "innocent ange"], ["🥰", "smiling_hearts love", "amoureux cœurs"], ["😍", "heart_eyes love", "yeux cœurs amour"],
    ["🤩", "star_struck wow", "ébloui étoiles"], ["😘", "kiss", "bisou"], ["😋", "yum tasty", "miam délicieux"],
    ["😛", "tongue", "langue"], ["😜", "wink_tongue crazy", "fou langue"], ["🤪", "zany crazy", "loufoque"],
    ["🤔", "thinking hmm", "réfléchir hmm"], ["🤨", "raised_eyebrow doubt", "sourcil doute"], ["😐", "neutral", "neutre"],
    ["😑", "expressionless", "inexpressif"], ["😶", "no_mouth silent", "sans bouche muet"], ["🙄", "eye_roll", "yeux au ciel"],
    ["😏", "smirk", "narquois"], ["😬", "grimace awkward", "grimace gêne"], ["😌", "relieved", "soulagé"],
    ["😔", "pensive", "pensif"], ["😴", "sleeping zzz", "dormir"], ["😷", "mask sick", "masque malade"],
    ["🤒", "thermometer sick", "fièvre malade"], ["🤯", "exploding_head mind_blown", "tête qui explose"], ["🥳", "party celebrate", "fête célébrer"],
    ["😎", "sunglasses cool", "lunettes cool"], ["🤓", "nerd geek", "intello"], ["🧐", "monocle inspect", "monocle examiner"],
    ["😕", "confused", "confus"], ["😟", "worried", "inquiet"], ["😮", "open_mouth wow", "bouche ouverte"],
    ["😲", "astonished", "stupéfait"], ["🥺", "pleading please", "supplier s'il te plaît"], ["😢", "cry sad", "pleurer triste"],
    ["😭", "sob crying", "sanglots pleurs"], ["😱", "scream fear", "cri peur"], ["😤", "triumph huff", "triomphe"],
    ["😡", "rage angry", "colère rage"], ["🤬", "cursing", "jurer"], ["😈", "devil", "diable"],
    ["💀", "skull dead", "crâne mort"], ["🤡", "clown", "clown"], ["🤖", "robot", "robot"], ["👻", "ghost", "fantôme"],
    ["🙈", "see_no_evil monkey", "singe ne rien voir"], ["🙊", "speak_no_evil", "singe ne rien dire"],
  ] },
  { key: "people", list: [
    ["👍", "thumbsup +1 yes like", "pouce oui j'aime"], ["👎", "thumbsdown -1 no", "pouce bas non"], ["👌", "ok_hand perfect", "ok parfait"],
    ["✌️", "victory peace", "victoire paix"], ["🤞", "fingers_crossed luck", "doigts croisés chance"], ["🤝", "handshake deal", "poignée de main accord"],
    ["👏", "clap bravo", "applaudir bravo"], ["🙌", "raised_hands hooray", "mains levées hourra"], ["🙏", "pray thanks please", "merci prier s'il te plaît"],
    ["💪", "muscle strong", "muscle fort"], ["👋", "wave hello bye", "salut bonjour au revoir"], ["🤙", "call_me", "appelle-moi"],
    ["👀", "eyes look", "yeux regarder"], ["🫡", "salute", "salut militaire"], ["🤷", "shrug dunno", "haussement d'épaules"],
    ["🤦", "facepalm", "consterné"], ["🙋", "raising_hand me", "lever la main moi"], ["🙆", "ok_person", "d'accord"],
    ["🙅", "no_gesture", "non geste"], ["💁", "tipping_hand info", "information"], ["👉", "point_right", "pointer droite"],
    ["👈", "point_left", "pointer gauche"], ["👆", "point_up", "pointer haut"], ["👇", "point_down", "pointer bas"],
    ["☝️", "index_up one", "index un"], ["✍️", "writing", "écrire"], ["🧠", "brain smart", "cerveau malin"],
    ["🫶", "heart_hands", "mains cœur"], ["👶", "baby", "bébé"], ["🧑‍💻", "technologist developer", "développeur informaticien"],
  ] },
  { key: "symbols", list: [
    ["❤️", "heart love red", "cœur amour rouge"], ["🧡", "orange_heart", "cœur orange"], ["💛", "yellow_heart", "cœur jaune"],
    ["💚", "green_heart", "cœur vert"], ["💙", "blue_heart", "cœur bleu"], ["💜", "purple_heart", "cœur violet"],
    ["🖤", "black_heart", "cœur noir"], ["🤍", "white_heart", "cœur blanc"], ["💔", "broken_heart", "cœur brisé"],
    ["💯", "100 hundred perfect", "cent parfait"], ["✅", "white_check_mark done yes", "coche fait oui"], ["✔️", "check", "coche"],
    ["❌", "x cross no", "croix non"], ["❗", "exclamation important", "exclamation important"], ["❓", "question", "question"],
    ["⚠️", "warning", "attention avertissement"], ["🚫", "no_entry forbidden", "interdit"], ["⭐", "star", "étoile"],
    ["🌟", "glowing_star", "étoile brillante"], ["✨", "sparkles new", "étincelles nouveau"], ["🔥", "fire hot lit", "feu chaud"],
    ["💥", "boom", "boum"], ["💡", "bulb idea", "ampoule idée"], ["💬", "speech_balloon comment", "bulle commentaire"],
    ["👁️‍🗨️", "eye_speech witness", "témoin"], ["🔔", "bell notification", "cloche notification"], ["🔕", "no_bell mute", "silence muet"],
    ["⏳", "hourglass waiting", "sablier attente"], ["⏰", "alarm clock", "réveil alarme"], ["🆗", "ok_button", "bouton ok"],
    ["🆕", "new", "nouveau"], ["🔴", "red_circle", "cercle rouge"], ["🟢", "green_circle", "cercle vert"], ["⚫", "black_circle", "cercle noir"],
  ] },
  { key: "nature", list: [
    ["🐶", "dog", "chien"], ["🐱", "cat", "chat"], ["🦊", "fox", "renard"], ["🐻", "bear", "ours"], ["🐼", "panda", "panda"],
    ["🦁", "lion", "lion"], ["🐸", "frog", "grenouille"], ["🐵", "monkey", "singe"], ["🐔", "chicken", "poule"],
    ["🦄", "unicorn", "licorne"], ["🐝", "bee", "abeille"], ["🦋", "butterfly", "papillon"], ["🐢", "turtle slow", "tortue lent"],
    ["🐙", "octopus", "pieuvre"], ["🐳", "whale", "baleine"], ["🌸", "cherry_blossom flower", "fleur cerisier"],
    ["🌹", "rose", "rose"], ["🌻", "sunflower", "tournesol"], ["🌱", "seedling grow", "pousse grandir"], ["🌳", "tree", "arbre"],
    ["🍀", "four_leaf_clover luck", "trèfle chance"], ["🍁", "maple_leaf autumn", "feuille érable automne"], ["☀️", "sun sunny", "soleil"],
    ["🌙", "moon night", "lune nuit"], ["🌈", "rainbow", "arc-en-ciel"], ["☁️", "cloud", "nuage"], ["🌧️", "rain", "pluie"],
    ["❄️", "snowflake cold", "flocon froid"], ["⚡", "zap lightning fast", "éclair rapide"], ["🌊", "wave ocean", "vague océan"],
  ] },
  { key: "food", list: [
    ["☕", "coffee", "café"], ["🍵", "tea", "thé"], ["🍺", "beer", "bière"], ["🍷", "wine", "vin"], ["🥂", "cheers champagne", "santé champagne"],
    ["🍕", "pizza", "pizza"], ["🍔", "burger", "burger"], ["🍟", "fries", "frites"], ["🌮", "taco", "taco"], ["🍣", "sushi", "sushi"],
    ["🍜", "ramen noodles", "ramen nouilles"], ["🥐", "croissant", "croissant"], ["🥖", "baguette bread", "baguette pain"], ["🧀", "cheese", "fromage"],
    ["🍰", "cake", "gâteau"], ["🎂", "birthday cake", "anniversaire gâteau"], ["🍪", "cookie", "cookie biscuit"], ["🍫", "chocolate", "chocolat"],
    ["🍎", "apple", "pomme"], ["🍌", "banana", "banane"], ["🍓", "strawberry", "fraise"], ["🥑", "avocado", "avocat"], ["🌶️", "pepper hot", "piment"],
  ] },
  { key: "activities", list: [
    ["🎉", "tada party congrats", "fête bravo félicitations"], ["🎊", "confetti", "confettis"], ["🎈", "balloon", "ballon"], ["🎁", "gift", "cadeau"],
    ["🏆", "trophy win", "trophée victoire"], ["🥇", "first_place gold", "première place or"], ["🎯", "dart target goal", "cible objectif"],
    ["⚽", "soccer football", "football"], ["🏀", "basketball", "basket"], ["🎾", "tennis", "tennis"], ["🚴", "bike cycling", "vélo"],
    ["🏃", "running run", "course courir"], ["🎮", "video_game", "jeu vidéo"], ["🎲", "dice game", "dé jeu"], ["🎵", "music note", "musique note"],
    ["🎨", "art palette", "art palette"], ["🎬", "movie clapper", "cinéma clap"], ["📸", "camera_flash photo", "photo appareil"],
  ] },
  { key: "objects", list: [
    ["🚀", "rocket launch ship", "fusée lancement"], ["✈️", "airplane travel", "avion voyage"], ["🚗", "car", "voiture"], ["🚆", "train", "train"],
    ["🏠", "house home", "maison"], ["🏢", "office building", "bureau immeuble"], ["🏖️", "beach holiday", "plage vacances"], ["🗺️", "map", "carte"],
    ["💻", "laptop computer", "ordinateur portable"], ["🖥️", "desktop", "écran ordinateur"], ["📱", "phone mobile", "téléphone portable"], ["⌨️", "keyboard", "clavier"],
    ["📅", "calendar date", "calendrier date"], ["📆", "calendar_spiral", "calendrier"], ["📌", "pushpin pin", "punaise épingle"], ["📎", "paperclip attachment", "trombone pièce jointe"],
    ["📝", "memo note", "note mémo"], ["📄", "page document", "page document"], ["📊", "chart bar stats", "graphique stats"], ["📈", "chart_up growth", "hausse croissance"],
    ["📉", "chart_down", "baisse"], ["📦", "package box shipped", "colis boîte"], ["🔒", "lock private", "cadenas privé"], ["🔑", "key", "clé"],
    ["🔍", "mag search", "loupe chercher"], ["🛠️", "tools fix", "outils réparer"], ["⚙️", "gear settings", "engrenage réglages"], ["🧪", "test experiment", "test expérience"],
    ["🐛", "bug", "bug bogue"], ["💰", "money bag", "argent sac"], ["💶", "euro money", "euro argent"], ["🧾", "receipt invoice", "reçu facture"],
    ["✉️", "envelope mail", "enveloppe courrier"], ["📣", "mega announcement", "annonce mégaphone"], ["🗓️", "planning", "planning"], ["⏱️", "stopwatch", "chronomètre"],
  ] },
];

export type Emoji = { emoji: string; name: string; words: string };

// All of them, in their groups' order, found by their words in either
// language.
export const emoji: Emoji[] = groups.flatMap(g => g.list.map(([e, enWords, frWords]) => ({ emoji: e, name: enWords.split(" ")[0]!, words: `${enWords} ${frWords}`.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase() })));
// The reactions offered at once, before the picker.
export const quick = ["👍", "❤️", "😂", "🎉", "👀", "✅"];

// find lists the emoji whose words start with what was typed.
export function find(typed: string, limit = 8): Emoji[] {
  const t = typed.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (!t) return [];
  return emoji.filter(e => e.words.split(/[\s_]+/u).some(w => w.startsWith(t)) || e.name.startsWith(t)).slice(0, limit);
}

// byName is the emoji a shortcode names (":tada:"), if any.
export function byName(name: string): string | undefined {
  return emoji.find(e => e.name === name)?.emoji;
}
