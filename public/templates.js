// Албан бичгийн дизайн темплейтүүд. .doc-* классууд doc-styles.css-ээс.
// Хэрэглэгч эдгээрийг засварлагчид оруулж, шууд засаад орчуулж, PDF/Word болгоно.
window.TEMPLATES = [
  {
    id: 'meeting-brief',
    name: 'Уулзалтын материал',
    emoji: '📋',
    desc: 'Стратегийн бизнес уулзалтын дизайнтай товч (өнгөт хүснэгт, картууд, урсгал).',
    html: `
<div class="doc-runhead"><span>[Байгууллагын нэр]</span><span class="r">[Уулзалтын нэр]</span></div>
<div class="doc-title">
  <h1>Стратегийн бизнес уулзалтын материал</h1>
  <div class="sub">[Тал 1] – [Тал 2]</div>
</div>

<div class="doc-section-title">Уулзалтын хамрах хүрээ</div>
<table class="doc-infotable">
  <tr><td class="label">Зорилго</td><td>[Уулзалтын зорилгыг энд бичнэ...]</td></tr>
  <tr><td class="label">Талууд</td><td>[Тал 1] – [Тал 2]</td></tr>
  <tr><td class="label">Огноо</td><td>2026.00.00, 00:00 цагт, [Байршил]</td></tr>
  <tr><td class="label">Оролцогчид</td><td>
    <table style="width:100%;border:0"><tr style="border:0">
      <td style="border:0;vertical-align:top;width:50%">
        <b>[Тал 1]:</b>
        <ol><li>[Нэр] – [Албан тушаал]</li><li>[Нэр] – [Албан тушаал]</li></ol>
      </td>
      <td style="border:0;vertical-align:top;width:50%">
        <b>[Тал 2]:</b>
        <ol><li>[Нэр] — [Албан тушаал]</li><li>[Нэр] — [Албан тушаал]</li></ol>
      </td>
    </tr></table>
  </td></tr>
</table>

<div class="doc-legend">
  <div class="chip red">Нэн чухал / Заавал шийдвэрлэх</div>
  <div class="chip orange">Өндөр ач холбогдол</div>
  <div class="chip blue">Дунд / Үйл ажиллагааны</div>
</div>

<div class="doc-section-title">Хэлэлцэх асуудлын тойм</div>
<div class="doc-cards">
  <div class="card red"><div class="n">1. Нэн чухал</div><div class="t">[Асуудал 1]</div><div class="bar"></div></div>
  <div class="card red"><div class="n">2. Нэн чухал</div><div class="t">[Асуудал 2]</div><div class="bar"></div></div>
  <div class="card red"><div class="n">3. Нэн чухал</div><div class="t">[Асуудал 3]</div><div class="bar"></div></div>
  <div class="card orange"><div class="n">4. Өндөр</div><div class="t">[Асуудал 4]</div><div class="bar"></div></div>
  <div class="card blue"><div class="n">5. Дунд</div><div class="t">[Асуудал 5]</div><div class="bar"></div></div>
</div>

<div class="doc-section-title">Уулзалтын урсгал</div>
<div class="doc-flow">
  <div class="step">Нээлт, хамтын зорилго</div><span class="arrow">→</span>
  <div class="step">Бизнесийн нөхцөл байдал</div><span class="arrow">→</span>
  <div class="step">5 хэлэлцэх асуудал</div><span class="arrow">→</span>
  <div class="step">Өөрчлөлтийн санал</div><span class="arrow">→</span>
  <div class="step">Дараагийн алхам</div>
</div>`,
  },

  {
    id: 'official-letter',
    name: 'Албан тоот',
    emoji: '🏛',
    desc: 'Байгууллагын албан тоот — толгой, огноо/дугаар, хүлээн авагч, гарын үсэг.',
    html: `
<div class="doc-letter">
  <div class="doc-letterhead">
    <div class="org">[БАЙГУУЛЛАГЫН НЭР]<br/><span style="font-weight:400;font-size:10pt;color:#556">[Хаяг · Утас · И-мэйл]</span></div>
    <div class="meta">Огноо: 2026.00.00<br/>Дугаар: №______</div>
  </div>
  <h1 style="text-align:center;color:#2c4a5e;font-size:18pt;margin:22px 0 6px">[БИЧГИЙН ГАРЧИГ]</h1>
  <p class="to">Хүлээн авагч: ____________________ -д</p>
  <p>&nbsp;</p>
  <p>[Үндсэн агуулгыг энд бичнэ. Албан ёсны, тодорхой найруулгатай байвал зохино.]</p>
  <p>&nbsp;</p>
  <p>[Дэлгэрэнгүй тайлбар, шаардлага, хүсэлт...]</p>
  <div class="sign">
    <p>Хүндэтгэсэн,</p>
    <p>____________________</p>
    <p>[Албан тушаал · Нэр]</p>
  </div>
</div>`,
  },

  {
    id: 'report-cover',
    name: 'Тайлан (хавтас)',
    emoji: '📊',
    desc: 'Тайлангийн нүүр хуудас + эхний хэсгүүд.',
    html: `
<div class="doc-cover">
  <div class="kicker">[Байгууллагын нэр]</div>
  <h1>[ТАЙЛАНГИЙН НЭР]</h1>
  <div class="sub" style="font-style:italic;color:#566">[Дэд гарчиг]</div>
  <div class="meta">[Хугацаа] · 2026 он</div>
</div>
<div class="doc-section-title">1. Ерөнхий мэдээлэл</div>
<p>[Тайлангийн зорилго, хамрах хүрээ...]</p>
<div class="doc-section-title">2. Гүйцэтгэл</div>
<p>[Хийгдсэн ажлууд...]</p>
<div class="doc-section-title">3. Дүгнэлт</div>
<p>[Үр дүн ба дараагийн алхам...]</p>`,
  },

  {
    id: 'blank',
    name: 'Хоосон',
    emoji: '📄',
    desc: 'Хоосон хуудас — өөрөө эхнээс нь бичих.',
    html: `<h1>Гарчиг</h1><p>Энд бичиж эхэлнэ үү...</p>`,
  },
];
