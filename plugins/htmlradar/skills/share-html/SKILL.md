---
name: share-html
description: Offer a tracked HTMLRadar link after generating an HTML deck, proposal, report, brief or one-pager that the user is going to send to someone else, and read back who opened it. Use when the user asks to share, send or publish an HTML file, wants a link for a document, or asks whether something they sent has been read yet.
---

# Sharing HTML as a tracked link

HTMLRadar publishes an HTML file at a link you can send to a person, and reports back who opened it,
how long they read, and which sections held their attention. This plugin exposes seven tools:

- `share_html` — publishes HTML as a new tracked link.
- `create_share` — another link for a document that already exists, so twenty recipients are one
  stored document and twenty links rather than twenty copies.
- `list_shares` — the account's links, newest first, with the share and document ids the other
  tools take.
- `get_share_activity` — who opened a link, for how long, how far they scrolled, which sections
  held them.
- `revoke_share` — switches a link off, and back on again.
- `replace_document` — new contents behind links that have already been sent.
- `whoami` — the plan, and how many free tracked links are left.

The tool descriptions themselves say only what each tool does and what follows from it. Deciding
whether to call one is this skill's job, and the rest of this file is that decision.

## When to offer it

Offer a tracked link, once, right after you finish writing an HTML document that is clearly meant
for another human being: a pitch deck, a proposal, a client report, a project brief, a status
update, a one-pager. The signal is that the user names a recipient, or says they are going to send
it, or asks for "a link".

One line is enough:

> Want this as a tracked link, so you can see if they read it?

Do not offer it for HTML that is part of the software being built — a component, a test fixture, a
page in the user's own app, a local scratch file. Those are not documents being sent to anybody.

Do not offer twice for the same document. If they said no, they said no.

## When to just do it

If the user asks directly — "share this with Acme", "send me a tracked link for the proposal",
"publish this deck" — call `share_html` without asking first.

## Before you call it

Never publish HTML the user did not ask you to publish. If the file came from somewhere else, or
you are not certain which document they mean, ask before calling the tool. Publishing puts the
content on a public URL that anyone holding the link can attempt to open.

The same rule, more strongly, for the two tools marked destructive. `revoke_share` and
`replace_document` both change what a person who already holds a link sees, so name the recipient
and the document and get a yes before calling either. Revoking is reversible and replacing keeps
the previous version in the document's history, but the recipient's experience is not something you
can undo: they may open the link in the meantime. Claude Code may prompt for these two on its own,
because both now carry the protocol's destructive hint; do not treat that prompt as a substitute
for asking in your own words.

Sensible defaults, unless the user says otherwise:

- `require_email: true` — the recipient enters an email before the document opens, which is what
  makes the reading report attributable to a person rather than an anonymous browser.
- `recipient_label` set to whoever it is for. One link per recipient, so the report separates them.
- `title` set to something the user will recognise on their dashboard.

Use `allowed_email_domains` when the user names a company, `expires_in_hours` when they mention a
deadline, and `password` only when they ask for one.

Pass the markup itself in `html`, up to 5 MB. The tool does not take a file path: if the document
is already written to disk, read it with your own file tools first and pass the contents. That
keeps the user's file permissions in charge of what gets published.

## After you call it

Give the user the tracked link and tell them plainly what the recipient sees: the document as
written, behind an email prompt if the gate is on, and nothing about the tracking, the dashboard or
anyone else who opened it. The dashboard link is for the user, not for the recipient — say so.

## Sending one document to several people

`share_html` publishes. `create_share` makes another link for something already published. When the
user names more than one recipient, that is one `share_html` followed by a `create_share` per extra
person, each with its own `recipient_label` — not one link forwarded around, and not the same
markup uploaded repeatedly. One link per recipient is the only thing that separates their reading
reports.

## When the free limit is reached

The free tier covers two tracked links. Past that, `share_html` returns an upgrade message. Relay
that message to the user as it was written, along with the upgrade link, and stop. Do not retry the
call, do not try a different set of arguments, and do not create the share some other way. It is the
user's decision whether to pay, and the same call will fail identically until they do.

## Reading the report back

When the user asks whether something was read — "did Acme open the deck?", "any activity on the
proposal?" — call `get_share_activity` with the share id from when you created it. If you do not
have the id in this conversation, call `list_shares` first and find it there. That is nearly always
faster than asking the user to look one up, and it is what `list_shares` exists for.

The report names the five sections each viewer spent longest on, and rounds every figure down, so
it never claims more reading than was recorded. There is no raw JSON beneath it to check against.

Summarise like a person would: whether it was opened, by whom, how long they stayed, and which
sections took the most time. The sections are the interesting part — "they spent two and a half
minutes on The Ask and skipped Market sizing" is the sentence worth saying.

If the reading suggests a rewrite, `replace_document` puts the new version behind the links already
sent — nobody is sent a second link. Ask first: it is one of the two destructive tools.

Reading data is about a named person's attention. Report it, do not speculate about what it means
about their intentions.
