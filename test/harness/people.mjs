// The team of the tests: five members of Acme SAS and two groups, as the
// Chest would assert them.
const id = (prefix, word) => `${prefix}_${word.padEnd(26, "a")}`;
const member = (word, firstName, lastName, extra = {}) => ({
  id: id("mbr", word), firstName, lastName, name: `${firstName} ${lastName}`, photo: null, role: null,
  isAdmin: false, isBuilder: false, groups: [], language: "en", timeZone: "Europe/Paris", ...extra,
});

const design = id("grp", "design"), sales = id("grp", "sales");

export const camille = member("camille", "Camille", "Martin", { isAdmin: true, groups: [design] });
export const sam = member("sam", "Sam", "Taylor", { groups: [sales] });
export const robin = member("robin", "Robin", "Lee");
export const lea = member("lea", "Léa", "Dubois", { language: "fr", groups: [design] });
export const hugo = member("hugo", "Hugo", "Bernard", { language: "fr", groups: [sales] });

export const members = [camille, sam, robin, lea, hugo];
export const groups = [
  { id: design, name: "Design", members: [camille.id, lea.id] },
  { id: sales, name: "Sales", members: [sam.id, hugo.id] },
];
