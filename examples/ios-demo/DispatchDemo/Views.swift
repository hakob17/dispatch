import DispatchSDK
import SwiftUI
import UserNotifications

struct RootView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        TabView {
            ForYouView().tabItem { Label("For you", systemImage: "newspaper") }
            InboxView().tabItem { Label("Inbox", systemImage: "tray") }.badge(state.unread)
            AlertsView().tabItem { Label("Alerts", systemImage: "bell.badge") }
            ProfileView().tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
        .tint(.red)
        .sheet(item: Binding(get: { state.openArticleId.map(ArticleRef.init) }, set: { state.openArticleId = $0?.id })) { ref in
            ArticleView(articleId: ref.id)
        }
    }
}

struct ArticleRef: Identifiable { let id: String }

// MARK: - For you

struct ForYouView: View {
    @EnvironmentObject var state: AppState
    @State private var strategy: RecommendationStrategy = .forYou
    @State private var items: [Recommendation] = []
    @State private var loading = false

    var body: some View {
        NavigationStack {
            List {
                Picker("Feed", selection: $strategy) {
                    Text("For you").tag(RecommendationStrategy.forYou)
                    Text("Trending").tag(RecommendationStrategy.trending)
                    Text("Latest").tag(RecommendationStrategy.latest)
                }
                .pickerStyle(.segmented)
                .listRowSeparator(.hidden)

                CardsSection(refreshKey: state.openArticleId)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))

                if items.isEmpty && !loading {
                    ContentUnavailableView("Nothing new", systemImage: "newspaper", description: Text("You've read everything — publish a story with `npm run demo -- breaking \"…\"`."))
                }
                ForEach(items) { item in
                    Button { state.openArticleId = item.id } label: { ArticleRow(item: item) }
                        .buttonStyle(.plain)
                }
            }
            .listStyle(.plain)
            .navigationTitle("Dispatch News")
            .refreshable { await load() }
            .task(id: strategy) { await load() }
            .onChange(of: state.openArticleId) { _, new in if new == nil { Task { await load() } } }
        }
    }

    func load() async {
        loading = true
        defer { loading = false }
        do { items = try await state.dispatch.recommendations(strategy, limit: 10) }
        catch { state.log("⚠︎ recommendations: \(error)") }
    }
}

// MARK: - Content cards

/// The reader's card feed (pinned first). Impressions are logged as cards appear.
struct CardsSection: View {
    @EnvironmentObject var state: AppState
    let refreshKey: String?
    @State private var cards: [ContentCard] = []

    var body: some View {
        VStack(spacing: 10) {
            ForEach(cards) { card in
                CardView(card: card, open: { tap(card) }, dismiss: card.dismissible ? { Task { await dismiss(card) } } : nil)
                    .onAppear { Task { await state.dispatch.logCardsViewed([card.id]) } }
            }
        }
        .task(id: refreshKey) { await load() }
        .refreshable { await load() }
    }

    func load() async {
        do { cards = try await state.dispatch.contentCards().cards }
        catch { state.log("⚠︎ cards: \(error)") }
    }

    func tap(_ card: ContentCard) {
        Task { await state.dispatch.logCardClicked(card.id, url: card.url) }
        state.log("Tapped card “\(card.title)”")
        if let url = card.url.flatMap(URL.init(string:)) { state.open(url) }
    }

    func dismiss(_ card: ContentCard) async {
        cards.removeAll { $0.id == card.id }
        try? await state.dispatch.dismissCards([card.id])
        state.log("Dismissed card “\(card.title)”")
    }
}

struct CardView: View {
    let card: ContentCard
    let open: () -> Void
    let dismiss: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if card.style != .classic, let url = card.imageUrl.flatMap(URL.init(string:)) {
                AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.secondary.opacity(0.15) }
                    .frame(height: card.style == .banner ? 110 : 150).clipped()
                    .accessibilityHidden(true)
            }
            if card.style != .banner {
                HStack(alignment: .top, spacing: 12) {
                    if card.style == .classic, let url = card.imageUrl.flatMap(URL.init(string:)) {
                        AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.secondary.opacity(0.15) }
                            .frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 6))
                            .accessibilityHidden(true)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(card.title).font(.subheadline.weight(.semibold))
                        if !card.body.isEmpty { Text(card.body).font(.footnote).foregroundStyle(.secondary).lineLimit(3) }
                        if let label = card.buttonLabel { Text("\(label) →").font(.footnote.weight(.semibold)).foregroundStyle(.red).padding(.top, 2) }
                    }
                    Spacer(minLength: 0)
                }
                .padding(12)
            }
        }
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        // Tap target first, then the overlay: its dismiss button must win over the card tap
        .contentShape(Rectangle())
        .onTapGesture(perform: open)
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 6) {
                if card.pinned { Image(systemName: "pin.fill").font(.caption2).padding(6).background(.thinMaterial, in: Circle()).accessibilityLabel("Pinned") }
                if let dismiss {
                    Button(action: dismiss) { Image(systemName: "xmark").font(.caption2.weight(.bold)).padding(10).background(.thinMaterial, in: Circle()) }
                        .buttonStyle(.borderless) // inside a List, a default-style button would take the whole row
                        .accessibilityLabel("Dismiss card")
                }
            }
            .padding(8)
        }
        .accessibilityElement(children: .contain) // title/text readable, dismiss stays its own button
        .accessibilityAction(named: Text(card.buttonLabel ?? "Open"), open)
    }
}

struct ArticleRow: View {
    let item: Recommendation
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AsyncImage(url: item.imageUrl.flatMap(URL.init(string:))) { $0.resizable().scaledToFill() } placeholder: { Color.secondary.opacity(0.15) }
                .frame(width: 84, height: 64).clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                Text(item.section?.uppercased() ?? "NEWS").font(.caption2.weight(.semibold)).foregroundStyle(.red)
                Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(3)
                if let score = item.score { Text("score \(score, specifier: "%.3f")").font(.caption2.monospacedDigit()).foregroundStyle(.secondary) }
            }
        }
        .padding(.vertical, 4)
    }
}

struct ArticleView: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss
    let articleId: String

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    AsyncImage(url: URL(string: "https://picsum.photos/seed/\(articleId)/800/450")) { $0.resizable().scaledToFit() } placeholder: { Color.secondary.opacity(0.15).frame(height: 200) }
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    Text("Article \(articleId)").font(.title2.bold())
                    Text("This screen stands in for your article page. Opening it sent an `article_read` event, so this story won't be recommended again and its section now weighs more in your For you feed.")
                        .foregroundStyle(.secondary)
                }
                .padding()
            }
            .toolbar { Button("Done") { dismiss() } }
            .onAppear {
                state.dispatch.articleRead(articleId)
                state.log("Read article \(articleId)")
            }
        }
    }
}

// MARK: - Inbox

struct InboxView: View {
    @EnvironmentObject var state: AppState
    @State private var messages: [InboxMessage] = []

    var body: some View {
        NavigationStack {
            List {
                if messages.isEmpty {
                    ContentUnavailableView("No messages", systemImage: "tray", description: Text("Try `npm run demo -- inapp`."))
                }
                ForEach(messages) { m in
                    Button { Task { await tap(m) } } label: {
                        HStack(alignment: .top) {
                            Circle().fill(m.read ? .clear : .red).frame(width: 8, height: 8).padding(.top, 6)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(m.title).font(.subheadline.weight(m.read ? .regular : .semibold))
                                Text(m.body).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .swipeActions {
                        Button("Delete", role: .destructive) { Task { try? await state.dispatch.deleteMessages([m.id]); await load() } }
                    }
                }
            }
            .navigationTitle("Message centre")
            .refreshable { await load() }
            .task {
                while !Task.isCancelled {
                    await load()
                    try? await Task.sleep(for: .seconds(15))
                }
            }
        }
    }

    func load() async {
        guard let r = try? await state.dispatch.inbox() else { return }
        messages = r.messages
        state.unread = r.unread
    }

    func tap(_ m: InboxMessage) async {
        try? await state.dispatch.markRead([m.id])
        state.log("Read inbox message “\(m.title)”")
        if let url = m.url.flatMap(URL.init(string:)) {
            await state.dispatch.reportClicked(m.id, url: m.url)
            state.open(url)
        }
        await load()
    }
}

// MARK: - Alerts

struct AlertsView: View {
    @EnvironmentObject var state: AppState
    @State private var groups: [PreferenceGroup] = []

    var body: some View {
        NavigationStack {
            Form {
                Section("Push notifications") {
                    LabeledContent("Status", value: state.pushStatus)
                    Button("Enable notifications") { Task { await state.enablePush() } }
                }
                Section {
                    ForEach(groups.filter(\.isNewsletter)) { g in toggle(g) }
                } header: { Text("Newsletters") } footer: {
                    Text("Configured in the Dispatch console. A newsletter only reaches people who subscribe — this app signs you up to Morning Briefing and Markets Daily.")
                }
                Section {
                    ForEach(groups.filter { !$0.isNewsletter }) { g in toggle(g) }
                } header: { Text("Topics") } footer: { Text("On for everyone until you turn them off — campaigns for a topic skip anyone who opted out.") }
                Section {
                    Button("Follow election night") { state.followElection() }
                } header: { Text("Live Activity") } footer: {
                    Text("Starts an election-night Live Activity on the Lock Screen and Dynamic Island. Its push token is registered with Dispatch, so the server can update it.")
                }
            }
            .navigationTitle("Alerts")
            .task(id: state.externalId) { await load() }
            .refreshable { await load() }
        }
    }

    func toggle(_ g: PreferenceGroup) -> some View {
        Toggle(isOn: Binding(get: { g.subscribed }, set: { v in Task { await set(g.id, v) } })) {
            VStack(alignment: .leading) {
                Text(g.name)
                if let d = g.description { Text(d).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }

    func load() async { groups = (try? await state.dispatch.preferences()) ?? [] }

    func set(_ id: String, _ value: Bool) async {
        if let updated = try? await state.dispatch.setPreferences([id: value]) {
            groups = updated
            state.log("\(value ? "Subscribed to" : "Unsubscribed from") \(updated.first { $0.id == id }?.name ?? id)")
        }
    }
}

// MARK: - Profile

struct ProfileView: View {
    @EnvironmentObject var state: AppState
    @State private var userId = "demo-reader-ios"

    var body: some View {
        NavigationStack {
            Form {
                Section("Identity") {
                    LabeledContent("Anonymous id", value: String(state.anonymousId.prefix(13)) + "…")
                    LabeledContent("Signed in as", value: state.externalId ?? "—")
                    if state.externalId == nil {
                        TextField("User id", text: $userId).textInputAutocapitalization(.never).autocorrectionDisabled()
                        Button("Sign in") { Task { await state.signIn(userId) } }
                    } else {
                        Button("Sign out", role: .destructive) { Task { await state.signOut() } }
                    }
                }
                Section("Server") {
                    LabeledContent("URL", value: state.config.baseUrl ?? "not configured")
                    LabeledContent("SDK key", value: state.config.sdkKey.map { String($0.prefix(14)) + "…" } ?? "missing")
                }
                Section("What the SDK did") {
                    ForEach(state.activity, id: \.self) { Text($0).font(.caption.monospaced()) }
                }
            }
            .navigationTitle("Profile")
        }
    }
}
