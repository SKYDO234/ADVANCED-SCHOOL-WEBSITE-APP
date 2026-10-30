import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { assetUrl, get, post } from '../api.js';
import { useApp } from '../store.jsx';
import { Alert, Button, Input, Loading, Textarea, formatDate, useToast } from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

const CLASS_OPTIONS = ['Nursery', 'LKG', 'UKG', ...Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`)];

function Section({ id, eyebrow, title, children, tint }) {
  return (
    <section id={id} className={`site-section${tint ? ' tint' : ''}`}>
      <div className="site-inner">
        {eyebrow ? <div className="site-eyebrow">{eyebrow}</div> : null}
        {title ? <h2 className="site-h2">{title}</h2> : null}
        {children}
      </div>
    </section>
  );
}

function ContentText({ text }) {
  if (!text) return null;
  const hasHtml = /<[a-z][\s\S]*>/i.test(text);
  if (hasHtml) return <div className="site-prose" dangerouslySetInnerHTML={{ __html: text }} />;
  return (
    <div className="site-prose">
      {String(text).split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
    </div>
  );
}

export default function PublicSite() {
  const toast = useToast();
  const { publicSite, reloadPublic, setPublicSite } = useApp();
  const { slug } = useParams();
  const [site, setSite] = useState(publicSite);
  const [page, setPage] = useState(null);
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(!publicSite);
  const [inquiry, setInquiry] = useState({ student_name: '', parent_name: '', email: '', phone: '', class_applied: '', message: '' });
  const [contact, setContact] = useState({ name: '', email: '', phone: '', subject: '', message: '' });
  const [busy, setBusy] = useState('');
  const [sent, setSent] = useState('');
  const [sentKind, setSentKind] = useState('');

  useEffect(() => {
    if (publicSite) { setSite(publicSite); setLoading(false); return; }
    get('/public/site').then((res) => { setSite(res); setPublicSite?.(res); }).catch(() => setSite(null)).finally(() => setLoading(false));
  }, [publicSite, setPublicSite]);

  useEffect(() => {
    get('/public/news').then((res) => setNews(res.items || [])).catch(() => setNews([]));
  }, []);

  useEffect(() => {
    if (!slug) { setPage(null); return; }
    get(`/public/pages/${slug}`).then(setPage).catch(() => setPage(null));
  }, [slug]);

  const submit = async (kind) => {
    setBusy(kind);
    setSent('');
    setSentKind('');
    try {
      const res = kind === 'inquiry'
        ? await post('/public/admissions/inquiry', inquiry)
        : await post('/public/contact', contact);
      setSent(res.message || 'Thank you — we will be in touch.');
      setSentKind(kind);
      toast.success('Sent successfully');
      if (kind === 'inquiry') setInquiry({ student_name: '', parent_name: '', email: '', phone: '', class_applied: '', message: '' });
      else setContact({ name: '', email: '', phone: '', subject: '', message: '' });
    } catch (err) {
      toast.error('Could not send', err.message);
    } finally {
      setBusy('');
    }
  };

  if (loading) return <div className="site-loading"><Loading label="Loading school website…" /></div>;
  if (!site || site.needsSetup) {
    return (
      <div className="site-loading">
        <div className="card card-pad" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h2 className="mb-1">Welcome</h2>
          <p className="fs-13 muted mb-2">This school workspace has not been set up yet.</p>
          <Link className="btn btn-primary" to="/setup">Set up the school</Link>
        </div>
      </div>
    );
  }

  const { school, website = {}, pages = [] } = site;
  const stats = Array.isArray(website.stats) && website.stats.length
    ? website.stats
    : [{ label: 'Students', value: '1,200' }, { label: 'Faculty', value: '80' }, { label: 'Since', value: '1998' }, { label: 'Pass rate', value: '99%' }];
  const navPages = pages.filter((p) => p.slug !== 'home');

  if (slug) {
    return (
      <div className="site-shell">
        <header className="site-nav">
          <div className="site-inner row-between">
            <Link to="/" className="site-brand">
              {school.logo_url ? <img src={assetUrl(school.logo_url)} alt="" /> : <span className="site-logo-mark"><Icon name="school" size={20} /></span>}
              <span><strong>{school.name}</strong><small>{school.tagline || ''}</small></span>
            </Link>
            <Link className="btn btn-primary btn-sm" to="/login">Sign in</Link>
          </div>
        </header>
        <Section eyebrow="Page" title={page?.title || 'Page not found'}>
          {!page ? <p className="muted">This page may have been unpublished. <Link to="/">Return home</Link>.</p> : <ContentText text={page.content} />}
        </Section>
        <footer className="site-footer"><div className="site-inner">© {new Date().getFullYear()} {school.name}</div></footer>
      </div>
    );
  }

  return (
    <div className="site-shell">
      <header className="site-nav">
        <div className="site-inner row-between">
          <Link to="/" className="site-brand">
            {school.logo_url ? <img src={assetUrl(school.logo_url)} alt="" /> : <span className="site-logo-mark"><Icon name="school" size={20} /></span>}
            <span><strong>{school.name}</strong><small>{school.tagline || ''}</small></span>
          </Link>
          <nav className="site-links">
            <a href="#about">About</a>
            <a href="#news">News</a>
            {navPages.slice(0, 3).map((p) => <Link key={p.slug} to={`/p/${p.slug}`}>{p.title}</Link>)}
            <a href="#admissions">Admissions</a>
            <a href="#contact">Contact</a>
          </nav>
          <Link className="btn btn-primary btn-sm" to="/login">Sign in</Link>
        </div>
      </header>

      <section className="hero">
        <div className="hero-inner">
          <div>
            {website.admissionsOpen !== false ? <span className="eyebrow"><Icon name="sparkles" size={13} /> Admissions open</span> : <span className="eyebrow">Welcome</span>}
            <h1 style={{ marginTop: 16 }}>{website.heroTitle || school.name}</h1>
            <p className="lead">{website.heroSubtitle || school.tagline || 'A caring, ambitious school where every child is known and challenged to do their best.'}</p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#admissions">Apply for admission</a>
              <a className="btn btn-ghost" href="#about" style={{ color: '#dbeafe', borderColor: 'rgba(255,255,255,0.25)' }}>Explore the school</a>
            </div>
          </div>
          <div className="hero-card">
            {website.heroImage ? (
              <img src={assetUrl(website.heroImage)} alt="" style={{ width: '100%', borderRadius: 14, maxHeight: 220, objectFit: 'cover' }} />
            ) : (
              <div className="hero-figure">
                {stats.slice(0, 4).map((s) => (
                  <div key={s.label} className="hero-stat"><div className="v">{s.value}</div><div className="l">{s.label}</div></div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="site-stats">
        <div className="site-inner grid grid-4">
          {stats.slice(0, 4).map((s) => (
            <div key={s.label} className="site-stat"><div className="v">{s.value}</div><div className="l">{s.label}</div></div>
          ))}
        </div>
      </div>

      <Section id="about" eyebrow="About us" title={`Why families choose ${school.name}`} tint>
        <div className="site-two-col">
          <ContentText text={website.aboutText || `${school.name} has been educating young people${school.city ? ` in ${school.city}` : ''} with a simple belief: high expectations and genuine care go together. Our teachers know every child by name, track their progress closely and keep families involved at every step.`} />
          <div className="site-facts">
            {school.affiliation ? <div><span className="l">Affiliation</span><span className="v">{school.affiliation}</span></div> : null}
            {school.principal_name ? <div><span className="l">Principal</span><span className="v">{school.principal_name}</span></div> : null}
            {school.address ? <div><span className="l">Campus</span><span className="v">{[school.address, school.city, school.state, school.pincode].filter(Boolean).join(', ')}</span></div> : null}
            {school.phone ? <div><span className="l">Phone</span><span className="v">{school.phone}</span></div> : null}
          </div>
        </div>
      </Section>

      <Section id="news" eyebrow="Latest" title="News, events & notices">
        {news.length === 0 ? <p className="muted">No news has been published yet.</p> : (
          <div className="site-news">
            {news.map((n) => (
              <article key={n.id} className="site-news-card">
                {n.cover_url ? <img src={assetUrl(n.cover_url)} alt="" /> : <div className="site-news-blank"><Icon name="communication" size={22} /></div>}
                <div className="p">
                  <div className="row gap-1"><span className="site-tag">{n.category}</span><span className="fs-12 muted">{formatDate(n.published_at)}</span></div>
                  <h3>{n.title}</h3>
                  <p>{n.excerpt || (n.body || '').slice(0, 140)}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section id="admissions" eyebrow="Admissions" title="Join our school community" tint>
        {website.admissionsOpen === false ? (
          <Alert tone="info" title="Admissions are closed">Please contact the school office for waiting-list information.</Alert>
        ) : (
          <div className="site-form-wrap">
            {sent && sentKind === 'inquiry' ? <Alert tone="success" title="Thank you!">{sent}</Alert> : null}
            <div className="field-row">
              <Input label="Student name" required value={inquiry.student_name} onChange={(e) => setInquiry({ ...inquiry, student_name: e.target.value })} />
              <Input label="Parent / guardian" value={inquiry.parent_name} onChange={(e) => setInquiry({ ...inquiry, parent_name: e.target.value })} />
              <Input label="Phone" required value={inquiry.phone} onChange={(e) => setInquiry({ ...inquiry, phone: e.target.value })} />
            </div>
            <div className="field-row">
              <Input label="Email" type="email" value={inquiry.email} onChange={(e) => setInquiry({ ...inquiry, email: e.target.value })} />
              <div>
                <label className="label">Class applying for</label>
                <select className="select" value={inquiry.class_applied} onChange={(e) => setInquiry({ ...inquiry, class_applied: e.target.value })}>
                  <option value="">Select class</option>
                  {CLASS_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <Textarea label="Anything we should know?" rows={3} value={inquiry.message} onChange={(e) => setInquiry({ ...inquiry, message: e.target.value })} />
            <Button variant="primary" loading={busy === 'inquiry'} onClick={() => submit('inquiry')} disabled={inquiry.student_name.length < 2 || inquiry.phone.length < 6}>Submit enquiry</Button>
          </div>
        )}
      </Section>

      <Section id="contact" eyebrow="Contact" title="Visit or get in touch">
        <div className="site-two-col">
          <div className="site-facts">
            {school.phone ? <div><span className="l">Phone</span><span className="v">{school.phone}</span></div> : null}
            {website.contactPhone && website.contactPhone !== school.phone ? <div><span className="l">Admissions</span><span className="v">{website.contactPhone}</span></div> : null}
            {school.email ? <div><span className="l">Email</span><span className="v"><a href={`mailto:${website.contactEmail || school.email}`}>{website.contactEmail || school.email}</a></span></div> : null}
            {school.address ? <div><span className="l">Address</span><span className="v">{[school.address, school.city, school.state, school.pincode].filter(Boolean).join(', ')}</span></div> : null}
            {school.website ? <div><span className="l">Website</span><span className="v">{school.website}</span></div> : null}
          </div>
          <div className="site-form-wrap">
            {sent && sentKind === 'contact' ? <Alert tone="success" title="Message sent">{sent}</Alert> : null}
            <div className="field-row">
              <Input label="Your name" required value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
              <Input label="Phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
            </div>
            <div className="field-row">
              <Input label="Email" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
              <Input label="Subject" value={contact.subject} onChange={(e) => setContact({ ...contact, subject: e.target.value })} />
            </div>
            <Textarea label="Message" rows={3} required value={contact.message} onChange={(e) => setContact({ ...contact, message: e.target.value })} />
            <Button variant="primary" loading={busy === 'contact'} onClick={() => submit('contact')} disabled={contact.name.length < 2 || contact.message.length < 5}>Send message</Button>
          </div>
        </div>
      </Section>

      <footer className="site-footer">
        <div className="site-inner">
          <div className="row-between row-wrap gap-3">
            <div>
              <div className="strong" style={{ color: '#fff' }}>{school.name}</div>
              <div className="fs-12" style={{ color: '#9fb2cf' }}>{school.tagline || ''}</div>
            </div>
            <div className="row gap-2">
              <Link to="/login">Parent &amp; staff portal</Link>
              <a href="#admissions">Admissions</a>
              <a href="#contact">Contact</a>
            </div>
          </div>
          <div className="fs-12" style={{ color: '#7f93b3', marginTop: 14 }}>© {new Date().getFullYear()} {school.name}. All rights reserved. {school.is_demo ? 'Demo workspace — data is illustrative.' : ''}</div>
        </div>
      </footer>
    </div>
  );
}
