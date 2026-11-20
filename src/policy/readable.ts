// Text Purser's checks cannot read (20 Nov, after the held-out evals v5 to v8: every wrong payment of v8, docs/evals/
// adversarial-v8.md, and most of v5's to v7's, was an order, pressure or a changed account written in a language whose
// words src/policy/multilingual.ts did not hold yet: Sinhala, Lao, Mongolian, Burmese, Telugu, Yiddish, Tibetan, Syriac,
// Inuktitut, Javanese. Each round added that round's languages, and the next held-out set brought new ones. v8's own
// pre-registration said so (its H3, stated expecting it not to hold): only what code checks structurally stops an invoice
// whose words no list holds). The root cause is not a missing language but that a line in a language the lists cannot
// read went through as if it said nothing. This module tells code when a line is in such a language, so the agent never
// pays that invoice alone: the CFO, who can have it read, decides (src/ap/checkerCore.ts, finding "text_not_read").
//
// What "read" means here: a line whose letters are in a script whose languages the lists hold words of (Greek, Hangul,
// Thai, Khmer, Sinhala, Malayalam and the other scripts of one language each), or, in the scripts many languages share
// (Latin, Cyrillic, Arabic, Devanagari, Bengali, Ethiopic), a line in one of the languages the lists hold. A line is
// not read when:
//   - it has letters of a script no list holds words of (Thaana, Gurmukhi, Odia, N'Ko, Tifinagh, Cherokee, ...);
//   - in a shared script, it has letters only languages the lists do not hold write (Hausa's ɓ ɗ ƙ, Kazakh's қ ң ұ,
//     Pashto's ښ ږ, Assamese's ৰ, Tigrinya's ቐ, Cantonese's 嘅 咗, ...);
//   - in a shared script, two or more of its words are common words of a language the lists do not hold (Swahili,
//     Tagalog, Basque, Welsh, Croatian, Estonian, Marathi, Nepali, ...), more than of any language they do hold;
//   - in a shared script, it is a sentence of four words or more of which none of three letters or more is a common word
//     of a language the lists hold (the languages no list here knows at all).
// Supplier names on file and the name the invoice is read under are taken out of a line first: a name is checked by the
// fraud checks, not read as words. Every list here is of common words, not of attacks: they tell a language, nothing
// more. Pure: no Node modules (the Worker runs it).

import { fold } from "./multilingual.js";
import { scriptOf, withoutTypography } from "./scripts.js";

/** The shared scripts: written by languages the lists hold and by languages they do not. */
const SHARED = ["Latin", "Cyrillic", "Arabic", "Devanagari", "Bengali", "Ethiopic"] as const;
type Shared = (typeof SHARED)[number];
/**
 * Scripts whose languages the lists hold words of, one language each or near enough (Han for Chinese and Japanese, kana,
 * Hangul, Hebrew for Hebrew and Yiddish, Syriac, the Brahmic scripts of the languages added after eval v8). Han,
 * Katakana, Myanmar and Canadian syllabics are also written by languages the lists do not hold, told apart by their
 * own letters (SCRIPT_MARKERS).
 */
const READ_SCRIPTS = new Set<string>([
  ...SHARED, "Greek", "Armenian", "Georgian", "Hebrew", "Syriac", "Gujarati", "Tamil", "Telugu", "Kannada", "Malayalam", "Sinhala", "Thai", "Lao",
  "Tibetan", "Myanmar", "Khmer", "Hangul", "Han", "Hiragana", "Katakana", "Canadian_Aboriginal",
]);
/** Scripts scriptOf (src/policy/scripts.ts) counts as "Other", named for a person. */
const OTHER_SCRIPTS = ["Tifinagh", "Nko", "Ol_Chiki", "Adlam", "Vai", "Javanese", "Balinese", "Sundanese", "Tai_Tham", "Tai_Viet", "Tai_Le", "New_Tai_Lue", "Yi", "Lisu",
  "Bamum", "Osage", "Hanifi_Rohingya", "Chakma", "Meetei_Mayek", "Limbu", "Lepcha", "Batak", "Buginese", "Samaritan", "Mandaic", "Coptic", "Glagolitic", "Runic",
  "Ogham", "Gothic", "Syloti_Nagri", "Kayah_Li", "Cham", "Saurashtra", "Canadian_Aboriginal", "Mende_Kikakui", "Wancho", "Toto", "Kawi", "Nag_Mundari", "Old_Turkic"] as const;
const SCRIPT_WORDS: Readonly<Record<string, string>> = { Thaana: "Thaana letters (Dhivehi)", Gurmukhi: "Gurmukhi letters (Punjabi)", Oriya: "Odia letters", Cherokee: "Cherokee letters",
  Bopomofo: "Bopomofo letters", Mongolian: "the Mongolian script", Nko: "N'Ko letters", Ol_Chiki: "Ol Chiki letters (Santali)", Tifinagh: "Tifinagh letters (Tamazight)" };

/** A script's name for a letter scriptOf counts as "Other". */
let otherRes: (readonly [string, RegExp])[] | undefined;
const otherScript = (ch: string) => {
  otherRes ??= OTHER_SCRIPTS.map((s) => [s, new RegExp(`\\p{Script=${s}}`, "u")] as const);
  return otherRes.find(([, re]) => re.test(ch))?.[0] ?? "Other";
};
const scriptWords = (s: string) => SCRIPT_WORDS[s] ?? (s === "Other" ? "letters of a script" : `${s.replace(/_/g, " ")} letters`);

/**
 * Letters that in their script only languages the lists do not hold write, and the language they say (a line with one
 * in a word of two or more letters is in that language, unless most of its words are of a language the lists hold).
 */
const LETTER_MARKERS: readonly { script: Shared | "Han" | "Katakana" | "Myanmar" | "Canadian_Aboriginal"; letters: RegExp; lang: string }[] = [
  { script: "Latin", letters: /[ɓɗƙƴ]/u, lang: "Hausa or Fula" },
  { script: "Latin", letters: /[ɛɔɲɖƒɣʋɩʊ]/u, lang: "a West or Central African language (Twi, Ewe, Lingala, Bambara)" },
  { script: "Latin", letters: /ŋ/u, lang: "an African or Sámi language" },
  { script: "Latin", letters: /ə/u, lang: "Azerbaijani" },
  { script: "Latin", letters: /[ħċ]/u, lang: "Maltese" },
  { script: "Latin", letters: /[ĉĝĥĵŝŭ]/u, lang: "Esperanto" },
  { script: "Latin", letters: /[ŵŷ]/u, lang: "Welsh" },
  { script: "Latin", letters: /ṣ/u, lang: "Yoruba" },
  { script: "Latin", letters: /ṅ/u, lang: "Igbo" },
  { script: "Latin", letters: /g̃/u, lang: "Guarani" },
  { script: "Latin", letters: /[og]ʻ/u, lang: "Uzbek" },
  { script: "Latin", letters: /ʻ/u, lang: "Hawaiian or Tongan" },
  { script: "Latin", letters: /l·l/u, lang: "Catalan" },
  { script: "Cyrillic", letters: /[әғқңұһҗҙҡҫӣӯҳҷӑӗӳӕӧӝӟӵӥӱӹӓҕҥӊӏҭҿҵԥҧ]/u, lang: "a Turkic, Iranian or Caucasian language in Cyrillic (Kazakh, Kyrgyz, Tajik, Tatar, Bashkir, Chuvash, Chechen, ...)" },
  { script: "Cyrillic", letters: /ў/u, lang: "Belarusian or Uzbek" },
  { script: "Cyrillic", letters: /[ѓќѕ]/u, lang: "Macedonian" },
  { script: "Arabic", letters: /[ټډړږښګڼېۍ]/u, lang: "Pashto" },
  { script: "Arabic", letters: /[ڄڃڇڊڌڍڏڙڦڪڱڳڻ۽]/u, lang: "Sindhi" },
  { script: "Arabic", letters: /[ۆۇۈۋێەڕڵ]/u, lang: "Uyghur or Kurdish" },
  { script: "Arabic", letters: /[ڠۏݨ]/u, lang: "Malay (Jawi) or Punjabi (Shahmukhi)" },
  { script: "Devanagari", letters: /[ॲळ]/u, lang: "Marathi or Konkani" },
  { script: "Bengali", letters: /[ৰৱ]/u, lang: "Assamese" },
  { script: "Ethiopic", letters: /[ቐ-ቖዀ-ዅ]/u, lang: "Tigrinya" },
];
/** Letters of a script the lists read that only other languages write in it (one is enough: no name on file has them). */
const SCRIPT_MARKERS: readonly { letters: RegExp; lang: string }[] = [
  { letters: /[嘅咗唔冇喺啲佢嘢嚟嗰哋㗎噉睇諗]/u, lang: "Cantonese" },
  { letters: /[ㇰ-ㇿ]/u, lang: "Ainu" },
  { letters: /[ၚ-ႏႚ-႟ꩠ-ꩿꧠ-꧿]/u, lang: "Shan, Mon or Karen (Myanmar letters Burmese does not use)" },
  { letters: /[ᐟ-ᐪ]/u, lang: "Cree or Ojibwe (syllabics Inuktitut does not use)" },
];

// ── Common words: the languages the lists hold (READ) and others (UNREAD), per shared script ──
// Written as people write them; folded as the lists fold text (accents and marks dropped, lower case, apostrophes out).

const READ_WORDS: Readonly<Record<Shared, string>> = {
  Latin: [
    // English
    "the and of to in is are was were be been will would for your you our we us this that these those with on at by from as it its not no please thank thanks invoice payment pay paid days day within order account bank due date amount total terms net goods delivery delivered services service all any an or if have has had can may should could more than agreed attached enclosed find questions contact regards dear kind best team per only one two our new same also before after until when here there them they their which who what about would has",
    // German
    "der die das den dem des und ist sind war für mit von zu zum zur ein eine einer einen nicht bitte wir sie ihr ihre ihnen unser unsere unseren auf im in bei auch vielen dank danke rechnung zahlung innerhalb tage tagen netto ohne abzug wie vereinbart lieferung freundliche grüße sehr geehrte zahlbar bis über bereits schon noch nur aus an am um es ab nach vor wird wurde werden wurden haben hat kein keine diese dieser dieses heute",
    // Dutch
    "de het een en van is zijn voor met op niet wij we u uw onze ons graag bedankt dank binnen dagen factuur betaling te naar bij als afgesproken levering vriendelijke groet groeten gelieve na al reeds nog alleen uit aan om dit deze die wordt werd worden hebben heeft geen vandaag",
    // French
    "le la les des du de et est sont pour avec sur dans nous vous votre vos notre nos merci ne pas une un au aux facture paiement jours sous veuillez par en à cette ce que qui livraison cordialement salutations déjà été être avons avez sera aujourd hui ces",
    // Spanish
    "el la los las de del y es son para por con en nuestro nuestra nuestros su sus gracias no un una al que factura pago días favor le se este esta entrega saludos atentamente plazo ya ha han sido hoy estos estas",
    // Italian
    "il lo la gli le di del della e è sono per con nel nella non un una grazie nostro nostra vostro vostra si prega che fattura pagamento giorni entro da al alla consegna cordiali saluti già stato stata oggi questo questa",
    // Portuguese
    "o a os as de do da e é para com em no na não um uma obrigado obrigada nosso nossa seu sua por fatura pagamento dias favor ao entrega cumprimentos prazo já foi hoje este esta",
    // Polish
    "i w z na do nie jest są dla się że od po prosimy dziękujemy dziękuję nasz nasze nasza naszej państwa faktura faktury płatność dni termin oraz za dostawa pozdrawiamy",
    // Czech, Slovak
    "a je jsou na v ve s se z do pro k od nebo děkujeme prosím naše náš váš vaše faktura platba dní dnů splatnost dodávka sú pre alebo ďakujeme prosíme naša faktúra splatnosť",
    // Turkish
    "ve bir bu için ile de da değil lütfen teşekkürler teşekkür ederiz bizim sizin fatura ödeme gün içinde olarak siparişiniz",
    // Vietnamese
    "và của là có không được cho với trong này chúng tôi quý khách cảm ơn vui lòng thanh toán hóa đơn ngày hàng",
    // Indonesian, Malay
    "dan yang di ke dari untuk dengan ini itu kami anda tidak terima kasih mohon harap tagihan faktur pembayaran hari dalam akan sudah ada sila akaun baharu",
    // Romanian
    "și în de la pe cu pentru este sunt nu vă mulțumim factura plata zile termen nostru noastră dumneavoastră",
    // Hungarian
    "a az és hogy nem van egy köszönjük kérjük számla fizetés napon belül vagy is fizetési határidő",
    // Lithuanian, Latvian
    "ir yra kad su iš į už mūsų jūsų ačiū prašome sąskaita mokėjimas dienų per ne apmokėti un ar uz no par lai mūsu jūsu paldies lūdzu rēķins apmaksa apmaksas dienas dienu termiņš nav sadarbību",
    // Icelandic, Swedish, Norwegian, Danish, Finnish
    "og er að í á fyrir með ekki við takk þú okkar ykkar reikningur greiðsla daga innan um viðskiptin greiðist dag vegna þessi þetta hefur var och är på till för av inte ni ert tack betalning dagar inom ikke dere deres jeres vår tak dager dage innen inden ja on ei se että kanssa kiitos lasku maksu päivää päivän sisällä meidän teidän hyvä maksettava eräpäivä",
    // Javanese
    "lan ing sing kanggo karo iki kuwi matur nuwun panjenengan kula aja ora sampun dinten",
    // More of the commonest words of the languages above: today, now, at once, all, without, previous, together, other,
    // must, can, here, our and your forms, and the verbs to be, have and pay.
    // The words of an invoice's own lines in those languages: bank details, account, transfer, reference, order, goods,
    // delivery, price, quantity, tax, attached, letter, mail, note, remain, changed, unchanged, kindly, regards.
    "details account transfer reference order goods delivery price quantity tax attached letter mail email note remain remains unchanged changed kindly regards bankverbindung konto überweisung verwendungszweck bestellung ware lieferung preis menge steuer anbei beigefügt brief bleibt bleiben unverändert geändert grüßen bankgegevens rekening overschrijving kenmerk bestelling goederen prijs aantal btw bijgevoegd brief blijft blijven ongewijzigd gewijzigd coordonnées bancaires compte virement référence commande marchandises prix quantité tva joint ci lettre courriel reste restent inchangées inchangé modifié datos bancarios cuenta transferencia referencia pedido mercancía precio cantidad iva adjunto carta correo permanece permanecen sin cambios cambiado coordinate bancarie conto bonifico riferimento ordine merce prezzo quantità allegato lettera posta resta restano invariate invariato modificato dados bancários conta transferência referência encomenda mercadoria preço quantidade anexo carta permanece permanecem inalterados alterado dane bankowe rachunek konto przelew zamówienie towar cena ilość załącznik list pozostają bez zmian zmienione bankovní spojení účet převod objednávka zboží cena množství příloha dopis zůstávají beze změny změněno banka hesap havale referans sipariş mal fiyat miktar ek mektup değişmedi değişti date bancare cont transfer comandă marfă preț cantitate anexă scrisoare rămân neschimbate schimbat bankszámla átutalás megrendelés áru ár mennyiség melléklet levél változatlan változott banko sąskaita pavedimas užsakymas prekės kaina kiekis priedas laiškas nepasikeitė bankas konts pārskaitījums pasūtījums preces cena daudzums pielikums vēstule nemainīgi mainīti bankareikningur millifærsla pöntun vörur verð magn viðhengi bréf óbreytt breytt bankkonto överföring beställning varor pris mängd bilaga brev oförändrade ändrade overførsel bestilling varer uendret uændret pankkitili tilisiirto tilaus tuotteet hinta määrä liite kirje ennallaan muuttunut rekening transfer pesanan barang harga jumlah lampiran surat tetap berubah tài khoản chuyển khoản đơn hàng hàng hóa giá số lượng đính kèm thư không đổi",
    "today now immediately without previous every other must here sofort jetzt alle vorherigen andere muss hier direct onmiddellijk nu zonder vorige alle andere moet hier immédiatement maintenant sans tous toutes précédentes autre doit ici inmediatamente ahora sin todos todas anteriores otro otra debe aquí immediatamente adesso senza tutti tutte precedenti altro deve qui imediatamente agora sem todos anteriores outro outra deve aqui natychmiast teraz bez wszystkie poprzednie inny musi tutaj dzisiaj okamžitě nyní bez všechny předchozí jiný musí zde dnes hemen şimdi olmadan tüm önceki başka gerekir burada bugün ngay bây giờ tất cả trước khác phải hôm nay segera sekarang tanpa semua sebelumnya lain harus sini imediat acum fără toate anterioare alt trebuie aici azi azonnal most nélkül minden előző más kell itt ma nedelsiant dabar be visus visas ankstesnes kitą turi čia šiandien nekavējoties tagad bez visus iepriekšējos citu jābūt šeit šodien strax núna án allar fyrri aðra verður hér til idag nu utan alla tidigare andra måste här i dag med det heti nyt ilman kaikki aiemmat muu pitää tänään saiki tanpa kabeh liyane kudu kene dina iki pague pagar pagate paga paguen bezahlen betalen payer payez zapłać zaplaťte ödeyin bayar plătiți fizesse sumokėkite apmaksājiet greiðið betala maksakaa",
  ].join(" "),
  Cyrillic: [
    "и в на с не по для мы вы ваш ваша наш наша это что от к спасибо пожалуйста счет счёт оплата оплаты дней течение уже ещё еще только как чтобы но или при после до за у его этот эта эти сегодня был была было были",
    "і та з на не для ми ви ваш наш дякуємо будь ласка рахунок оплата днів протягом цей ця це ці його нього вже ще лише тільки як що щоб але або при після до від за у в й",
    "и на за с не от ние вие ваш наш благодарим моля фактура плащане дни срок вече още само как че но или при след до този тази това днес",
    "и на за са не од ми ви ваш наш хвала молимо фактура плаћање дана рок већ још само како да али или при после до овај ова ово данас",
    "бөгөөд ба болон нь энэ бид та таны манай баярлалаа төлбөр нэхэмжлэх хоног дотор өнөөдөр одоо шууд бүх өмнөх өөр хэнд ч битгий бүү",
    // Today, now, at once, all, without, previous, other, together, must, here, in Russian, Ukrainian, Bulgarian and Serbian.
    "сегодня сейчас немедленно все всех без предыдущие другой должны здесь сьогодні зараз негайно всі усі без попередні інший разом із має тут днес сега веднага всички без предишни друг заедно трябва тук данас сада одмах сви без претходна други заједно мора овде",
  ].join(" "),
  Arabic: [
    "في من على إلى عن مع هذه هذا نحن شكرا الفاتورة فاتورة الدفع يوم أيام يرجى خلال",
    "و در از به با این را که است ما شما لطفا سپاس متشکریم فاکتور پرداخت روز",
    "اور میں سے کو کی کا کے ہے ہیں یہ ہم آپ شکریہ براہ کرم ادائیگی دن",
  ].join(" "),
  Devanagari: "और का की के में है हैं से को यह हम आप कृपया धन्यवाद भुगतान बिल दिन भीतर पर नहीं चालान",
  Bengali: "এবং ও আমাদের আপনার ধন্যবাদ অনুগ্রহ করে দিন মধ্যে বিল পরিশোধ না হয় করুন চালান",
  Ethiopic: "እና ነው ናቸው እባክዎ እናመሰግናለን ክፍያ ቀናት ውስጥ ደረሰኝ ይህ የእኛ",
};

const UNREAD_WORDS: Readonly<Record<Shared, Readonly<Record<string, string>>>> = {
  Latin: {
    Swahili: "tafadhali lipa malipo ankara hii hizi huu leo sasa haraka bila kwa kwenye yetu wetu yako wako asante ahsante akaunti benki mkurugenzi siku ndani kabla usimwambie mtu yeyote maelekezo puuza idhini kiasi jumla mpya namba tunaomba ndiyo hapana baada",
    Yoruba: "jọwọ owo sanwo ṣe ati yin rẹ ẹ ṣeun oni lẹsẹkẹsẹ akọọlẹ gbogbo maṣe iwe",
    Hausa: "biya kudi yau yanzu asusun sabon sabuwar wannan wanda kada kowa umarni gode godiya",
    Igbo: "biko kwụọ ugwo ego taa akaụntụ ọhụrụ ndị nke gị anyị unu ozugbo ekele daalụ",
    Zulu: "ngicela sicela khokha inkokhelo namuhla manje ngokushesha akhawunti ibhange entsha yethu wethu yakho ngiyabonga siyabonga ungatsheli muntu umphathi imiyalelo ziba ngaphandle imvume futhi kanye",
    Xhosa: "nceda hlawula intlawulo namhlanje ngoku ngokukhawuleza iakhawunti ibhanki entsha yethu enkosi musa xelela mntu umlawuli imiyalelo ngaphandle imvume kwaye",
    Somali: "fadlan bixi lacag lacagta maanta hadda degdeg xisaab xisaabta bangiga cusub annaga idinka mahadsanid sheegin qofna maareeyaha tilmaamaha ogolaansho iyo waa ee kale waxaa",
    Malagasy: "azafady aloavy vola androany izao haingana kaonty banky vaovao anay anareo misaotra aza lazaina olona toromarika hadino fankatoavana sy ny amin ho ary dia izy ity",
    Tagalog: "pakibayaran bayaran bayad magbayad ngayon ngayong agad kaagad bangko namin ninyo inyo salamat huwag sabihin sinuman tagubilin utos balewalain pansinin pahintulot mga ng ang po ito kung",
    Cebuano: "palihug bayri karon dayon dali bangko among inyong salamat ayaw sultihi bisan kinsa mga ug ang kini nga",
    Maori: "koa utu utua moni inaianei tonu kaute peeke hou matou koutou tena kia ora nga kei kaua korero tetahi whakahau whakaae",
    Samoan: "faamolemole totogi tupe vave faletupe fou matou outou faafetai aua tasi",
    Basque: "mesedez ordaindu ordainketa gaur orain berehala kontua bankua berria gure zure eskerrik asko esan inori zuzendaria argibideak jarraibideak baimen eta dira bat egun barru honako hau hori",
    Catalan: "amb els aquesta aquest aquests pagament pagueu avui immediatament nostre nostra vostre vostra gràcies moltes digueu ningú instruccions ignoreu aprovació termini",
    Galician: "grazas nosa noso vosa voso unha xa hoxe dende ningún digades instrucións sen aprobación",
    Welsh: "gwelwch dda talu taliad heddiw nawr unwaith cyfrif newydd eich diolch peidiwch dweud wrth neb cyfarwyddwr cyfarwyddiadau anwybyddu caniatâd gyda mae ydy hwn hon dyddiau yr yn ac",
    Irish: "thoil íoc íocaíocht inniu anois láithreach cuntas bhur raibh maith agat inis duine stiúrthóir treoracha neamhaird cead agus leis seo laethanta",
    "Scottish Gaelic": "pàigh pàigheadh diugh nis bhad cunntas tapadh leat innis stiùiriche stiùiridhean chead agus tha seo",
    Breton: "plij paeañ hiziv bremañ diouzhtu nevez trugarez lavarit rener kemennoù aotre gant emañ",
    Maltese: "jekk jogħġbok ħallas ħlas illum issa minnufih ġdid ġdida tagħna tagħkom grazzi tgħidx ħadd istruzzjonijiet injora approvazzjoni fil għal huwa dan din jiem",
    Albanian: "lutem paguani pagesa sot tani menjëherë llogari llogaria tonë juaj faleminderit mos tregoni askujt drejtori udhëzimet injoroni miratim dhe është një nga që kjo ky ditë",
    Estonian: "palun makske makse täna kohe pank uus uue meie teie aitäh tänan ärge öelge kellelegi juhataja juhised ignoreerige kinnitus päeva jooksul arve",
    Esperanto: "bonvolu pagu hodiaŭ tuj nia dankon diru ajn direktoro instrukciojn ignoru aprobo kaj estas kun tiu tagoj",
    Quechua: "hina kaspa qullqi kunan chaylla musuq ñuqayku qamkuna sulpayki willaychu pimanpas kamachikuykuna kay chay punchaw",
    "Haitian Creole": "tanpri peye peman jodi kounye touswit nouvo mèsi pèsonn direktè enstriksyon inyore apwobasyon ak nan pou jou",
    Afrikaans: "asseblief vandag onmiddellik nuwe julle dankie moenie vertel direkteur instruksies ignoreer vir hierdie dae",
    Faroese: "vinarliga gjaldið beinanvegin konta nýggj okkara tykkara sigið nøkrum stjóri góðkenning fyri hesin hetta",
    Luxembourgish: "gelift bezuelt bezuelen elo neit eis ären sot kengem näischt direkter instruktiounen ignoréiert ass vun fir mat dës dësen deeg bannent",
    Frisian: "asjebleaft betelje hjoed fuortendaliks rekken nij tankewol sizze gjinien ynstruksjes negearje goedkarring fan foar mei",
    Azerbaijani: "zəhmət olmasa ödəyin ödəniş dərhal təşəkkür edirik deməyin heç kimə təlimatlar nəzərə almayın təsdiq üçün ərzində",
    Uzbek: "iltimos toʻlang toʻlov bugun hozir darhol hisob yangi bizning sizning rahmat aytmang hech kimga koʻrsatmalar bermang tasdiq uchun bilan ichida",
    Turkmen: "haýyş tölän töleg häzir derrew hasap täze biziň siziň sag boluň aýtmaň görkezmeler tassyklama bilen",
    Kurdish: "kerema xwe bidin îro niha tavilê spas nebêjin kesî rêveber talîmat erêkirin ji ev ew roj",
    Slovenian: "prosimo plačajte plačilo danes takoj račun hvala povejte nikomur navodila prezrite odobritev",
    Croatian: "molimo platite plaćanje uplata danas odmah račun hvala nemojte recite nikome upute uputstva zanemarite odobrenje",
    Kinyarwanda: "nyamuneka mwishyure kwishyura munsi vuba konti nshya yacu yanyu murakoze ntimubwire umuyobozi amabwiriza kwemeza kandi iyi iminsi",
    Shona: "ndapota bhadharai mubhadharo nhasi izvozvi nekukurumidza akaundi bhangi itsva yedu yenyu maita basa musaudza munhu maneja mirairo mvumo uye kuti mazuva",
    Wolof: "fey fayu tey léegi bees sunu jërëjëf bul kenn njiit ndigal ngir",
    Lingala: "futa mbongo lelo sikoyo noki sika biso bino matondi koyebisa mokonzi malako ndingisa mpe oyo mikolo",
    Oromo: "maaloo kaffalaa kaffaltii amma battalumatti herrega baankii haaraa keenya keessan galatoomaa himinaa nama hogganaa qajeelfama mirkaneessa irraa keessa guyyaa",
    "Tok Pisin": "plis peim tede kwiktaim beng nupela bilong mipela yupela tenkyu tokim wanpela bosman dispela orait",
    Guarani: "pirapire koʼága pyaʼe pyahu aguyje emombeʼu avavépe mburuvicha",
    Occitan: "plai pagatz uèi sulpic novèl digatz degun ignoratz aqueste jorns",
    Corsican: "oghje avà subitu contu novu nostru vostru nimu istruzzioni ignurate appruvazione ghjorni",
    Romansh: "plaschair pajai ussa noss voss betg nagin directur instrucziuns ignorai approvaziun quest",
    "Northern Sámi": "leage buorre máksse odne dál dakkaviđe báŋku ođđa giitu allet muital oktiige jođiheaddji rávvagat lea beaivvi",
    Sundanese: "punten mayar ayeuna poé ieu geura anjeun hatur nuhun ulah béjakeun saha waé idin jeung éta",
    Tetum: "selu osan ohin lalais banku foun ami imi obrigadu labele hatene ema ida instrusaun aprovasaun iha husi loron",
    Fijian: "yalo vinaka sauma ilavo nikua vakatotolo akaude baqe vou keimami kemuni vakalevu kakua tukuna iliuliu ivakaro vakadonui oqo",
    Tongan: "kataki totongi paʻanga ʻaho ʻeni ʻakauni pangike foʻou ʻemau hoʻomou mālō ʻoua talanoa fakahinohino fakangofua",
    Tahitian: "hamani maitai aufau teie mahana oioi mauruuru eiaha parau tahi faatere faaueraa faatiaraa",
    Hmong: "thov nyiaj hnub tam sim khauj txhab tshiab peb nej tsaug tsis txhob qhia leej twg thawj cov lus kev pom zoo thiab rau ntawm hauv",
    Sesotho: "kopo lefa tefo kajeno hona joale hanghang akhaonte ncha rona lona leboha bolella motho motsamaisi ditaelo tumello matsatsi",
    Setswana: "tsweetswee duela tuelo gompieno jaanong bonako akhaonto ntšha leboga bolelele tetla malatsi",
    Twi: "mepa kyɛw tua nnɛ seesei ntɛm sikakorabea foforɔ yɛn meda obiara panin akwankyerɛ",
    Luganda: "nsaba musasule okusasula leero mangu akawunti bbanka empya yaffe yammwe webale temubuulira yenna akulira ebiragiro olukusa ennaku",
    Kikuyu: "ndagũthaitha rĩhai mbeca ũmũthĩ rĩu narua njerũ iitũ ciitũ ngatho mũtikeere mũndũ mũnene mataaro rũtha",
  },
  Cyrillic: {
    Belarusian: "калі ласка дзякуй аплаціце сёння неадкладна рахунак новы кажыце нікому дырэктар інструкцыі ігнаруйце дазвол",
    Macedonian: "молиме денес веднаш благодариме кажувајте упатства игнорирајте одобрување плаќање",
    Kazakh: "өтінеміз төлеңіз бүгін қазір дереу шот жаңа біздің сіздің рахмет айтпаңыз ешкімге директор нұсқаулар елемеңіз рұқсат және үшін",
    Kyrgyz: "сураныч төлөңүз бүгүн азыр дароо эсеп жаңы биздин сиздин рахмат айтпаңыз эч кимге нускамалар уруксат жана үчүн",
    Tajik: "лутфан пардохт имрӯз ҳозир фавран ҳисоб нав мо шумо ташаккур нагӯед ҳеҷ касро директор дастурҳо иҷозат ва барои",
  },
  Arabic: {
    Pashto: "مهرباني تادیه نن اوس سمدستي حساب نوی زموږ ستاسو مننه مه ووایاست هیچا ته مدیر لارښوونې اجازه دا په چې ته",
    "Kurdish (Sorani)": "تکایە پارە بدەن ئەمڕۆ ئێستا یەکسەر حساب نوێ ئێمە ئێوە سوپاس مەڵێن کەس بەڕێوەبەر ڕێنمایی ڕێگەپێدان ئەم لە بۆ",
    Uyghur: "مەرھەمەت تۆلەڭ بۈگۈن ھازىر دەرھال ھېسابات يېڭى بىزنىڭ سىزنىڭ رەھمەت دېمەڭ ھېچكىمگە يوليورۇق ۋە ئۈچۈن",
    Sindhi: "مهرباني ڪري ادا اڄ هاڻي فوري کاتو نئون اسان جو اوهان جو مهرباني ڪنهن کي نه ٻڌايو هدايتون ۽",
  },
  Devanagari: {
    Marathi: "आहे आहेत आणि आम्ही तुम्ही आमच्या आमचे आमचा तुमच्या तुमचे करा भरा देयक आज लगेच ताबडतोब खाते नवीन कोणालाही सांगू नका संचालक दुर्लक्ष मंजुरी ची चा चे मध्ये नाही हे ही या साठी दिवस",
    Nepali: "छ छन् छैन र हो हामी तपाईं तपाईंको हाम्रो गर्नुहोस् तिर्नुहोस् भुक्तानी अहिले तुरुन्तै नयाँ कसैलाई नभन्नुहोस् निर्देशक बेवास्ता स्वीकृति मा लागि भित्र यो त्यो",
    Konkani: "आयज रोखडेंच आमचें तुमचें बरें करूं कोणाकूच नाकात सुचोवण्यो मान्यताय आनी आसा खातीर दीस करात फारीक",
    Sanskrit: "ददातु अद्य शीघ्रम् अस्माकम् युष्माकम् धन्यवादः कथयतु कस्मै अपि निदेशकः अनुदेशाः उपेक्षताम् अनुमतिः च अस्ति एतत् अस्य दिनानि",
  },
  Bengali: {
    Assamese: "অনুগ্ৰহ আজি আমাৰ আপোনাৰ কৰক হিচাপ বেংক তৎক্ষণাত কাকো নকব সঞ্চালক নিৰ্দেশনা আৰু",
  },
  Ethiopic: {
    Tigrinya: "ብኽብረትኩም ክፈሉ ክፍሊት ሎሚ ሕጂ ብቕልጡፍ ሕሳብ ባንኪ ሓድሽ ናትና ናትኩም የቐንየልና ኣይትንገሩ ንማንም መምርሒታት ዕሽሽ ፍቓድ ኣብ ናይ እዩ ምስ እዚ መዓልቲ",
  },
};

/** A word as these lists compare it: folded as the lists fold text, without apostrophes or the ʻokina. */
const asWord = (w: string) => fold(w).replace(/['’ʻʼ`]/g, "");
/** Arabic and Ethiopic join little words to the next one ("والدفع", "የባንክ"): the word and the word without them. */
const PREFIXES: Partial<Record<Shared, readonly string[]>> = { Arabic: ["وال", "بال", "لل", "ال", "و", "ب", "ل", "ف"], Ethiopic: ["የ", "በ", "ለ", "ከ"] };
const variants = (w: string, s: Shared) => [w, ...(PREFIXES[s] ?? []).filter((p) => w.startsWith(p) && w.length > p.length + 1).map((p) => w.slice(p.length))];

let lexicons: { read: Record<Shared, Set<string>>; unread: Record<Shared, [string, Set<string>][]> } | undefined;
/** The lists as sets, built the first time a line is read (the kit11 Worker's start stays within Cloudflare's CPU limit). */
function lexicon() {
  if (lexicons) return lexicons;
  const words = (s: string) => s.split(/\s+/).filter(Boolean).map(asWord).filter(Boolean);
  const read = Object.fromEntries(SHARED.map((s) => [s, new Set(words(READ_WORDS[s]))])) as Record<Shared, Set<string>>;
  // A word that is also a common word of a language the lists hold tells nothing ("na" is Swahili and Polish).
  const unread = Object.fromEntries(SHARED.map((s) => [s, Object.entries(UNREAD_WORDS[s]).map(([lang, list]) => [lang, new Set(words(list).filter((w) => !read[s].has(w)))] as [string, Set<string>])])) as Record<Shared, [string, Set<string>][]>;
  return (lexicons = { read, unread });
}

/** The script of a word: of its first letter. */
const wordScript = (w: string) => { for (const ch of w) { const s = scriptOf(ch); if (s) return s === "Other" ? otherScript(ch) : s; } return null; };
const isShared = (s: string | null): s is Shared => !!s && (SHARED as readonly string[]).includes(s);
const URLISH = /\b(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+/giu;
/**
 * A line that ends a sentence: its last word, of two letters or more and not all capitals (an abbreviation, "S.p.A."),
 * followed by a full stop, a question or an exclamation mark, in any script.
 */
const SENTENCE_END = /(?:^|[^\p{L}\p{M}])(?=[\p{L}\p{M}]*[^\P{L}\p{Lu}])[\p{L}\p{M}]{2,}[)"'”’»]?\s*[.!?।॥።፧؟。！？။།]\s*$/u;
/** A label before a line's first colon ("Kontoinhaber:", "Note:"), up to three words: the sentence is what follows it. */
const LABEL = /^[^:：\n]{1,30}[:：]\s*/u;

/** Why a line is not read, or null when it is (or has too few words to say). */
export function unreadWhy(line: string, names: readonly string[] = []): string | null {
  let t = withoutTypography(line).normalize("NFKC");
  for (const n of names) {
    const name = withoutTypography(n).normalize("NFKC").trim();
    if (name.length >= 2) t = t.split(name).join(" ");
  }
  t = t.replace(URLISH, " ");
  const raw = t.toLowerCase();
  // Letters by script.
  const letters = new Map<string, number>();
  for (const ch of t) {
    const s = scriptOf(ch);
    if (!s) continue;
    const name = s === "Other" ? otherScript(ch) : s;
    letters.set(name, (letters.get(name) ?? 0) + 1);
  }
  for (const [s, n] of letters) if (n >= 2 && !READ_SCRIPTS.has(s)) return `a line in ${scriptWords(s)}, a script whose languages Purser's checks hold no words of`;
  for (const m of SCRIPT_MARKERS) if (m.letters.test(t)) return `a line in ${m.lang}, a language Purser's checks hold no words of`;
  const words = asWord(t).split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  const byScript = new Map<Shared, string[]>();
  for (const w of words) {
    const s = wordScript(w);
    if (isShared(s)) byScript.set(s, [...(byScript.get(s) ?? []), w]);
  }
  const { read, unread } = lexicon();
  for (const [s, ws] of byScript) {
    const distinct = [...new Set(ws)];
    const readHits = distinct.filter((w) => variants(w, s).some((v) => read[s].has(v)));
    const mostlyRead = readHits.length >= 2 && readHits.length * 2 >= distinct.length;
    // Letters only languages the lists do not hold write, in a word of two letters or more.
    const marker = LETTER_MARKERS.find((m) => m.script === s && raw.split(/[^\p{L}\p{M}ʻ·]+/u).some((w) => [...w].length >= 2 && m.letters.test(w)));
    if (marker && distinct.length >= 2 && !mostlyRead) return `a line in ${marker.lang}, a language Purser's checks hold no words of`;
    // Common words of a language the lists do not hold.
    let best: [string, number] | null = null;
    for (const [lang, set] of unread[s]) {
      const hits = distinct.filter((w) => variants(w, s).some((v) => set.has(v))).length;
      if (hits >= 2 && hits > readHits.length && (!best || hits > best[1])) best = [lang, hits];
    }
    if (best) return `a line in ${best[0]}, a language Purser's checks hold no words of`;
    // A sentence in words of no language the lists hold (what follows a label, when there is one).
    const longRead = readHits.filter((w) => [...w].length >= 3);
    const body = t.trim().replace(LABEL, "");
    const bodyWords = asWord(body).split(/[^\p{L}\p{M}]+/u).filter((w) => wordScript(w) === s);
    if (new Set(bodyWords).size >= 4 && longRead.length === 0 && (SENTENCE_END.test(body) || (bodyWords.length >= 6 && !/\p{Nd}/u.test(body)))) {
      return `a sentence in ${s === "Latin" ? "Latin letters" : `${s} letters`} with no word of a language Purser's checks hold`;
    }
  }
  return null;
}

/** Each line of a text that Purser's checks cannot read, with why (unreadWhy), in order. */
export function unreadLines(text: string, names: readonly string[] = []): { line: number; why: string }[] {
  const out: { line: number; why: string }[] = [];
  text.split("\n").forEach((l, i) => {
    const why = unreadWhy(l, names);
    if (why) out.push({ line: i + 1, why });
  });
  return out;
}
