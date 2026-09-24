#if canImport(SwiftUI) && os(iOS)
import SwiftUI

/// Watches the message centre and presents pop-up in-app messages
/// (modal, banner, full screen) over your UI.
///
///     ContentView()
///         .dispatchInAppMessages(dispatch) { url in router.open(url) }
@available(iOS 15.0, *)
public extension View {
    func dispatchInAppMessages(_ client: DispatchClient, pollInterval: TimeInterval = 60, onOpen: @escaping @MainActor (URL) -> Void = { _ in }) -> some View {
        modifier(InAppMessageHost(client: client, pollInterval: pollInterval, onOpen: onOpen))
    }
}

@available(iOS 15.0, *)
@MainActor
final class InAppMessageModel: ObservableObject {
    @Published var current: InboxMessage?
    private var queue: [InboxMessage] = []
    private var shown = Set<String>()
    let client: DispatchClient

    init(client: DispatchClient) { self.client = client }

    func refresh() async {
        guard let result = try? await client.inbox(limit: 20) else { return }
        let fresh = result.messages.filter { $0.display && !shown.contains($0.id) && !queue.contains($0) }.reversed() // oldest first
        queue.append(contentsOf: fresh)
        showNext()
    }

    private func showNext() {
        guard current == nil, !queue.isEmpty else { return }
        let next = queue.removeFirst()
        shown.insert(next.id)
        current = next
        Task { await client.reportDisplayed(next.id) }
    }

    func dismiss() {
        current = nil
        showNext()
    }

    func tap(_ urlString: String?, onOpen: (URL) -> Void) {
        guard let message = current else { return }
        let link = urlString ?? message.url
        Task { await client.reportClicked(message.id, url: link) }
        dismiss()
        if let link, let url = URL(string: link) { onOpen(url) }
    }
}

@available(iOS 15.0, *)
struct InAppMessageHost: ViewModifier {
    @StateObject private var model: InAppMessageModel
    @Environment(\.scenePhase) private var scenePhase
    let pollInterval: TimeInterval
    let onOpen: @MainActor (URL) -> Void

    init(client: DispatchClient, pollInterval: TimeInterval, onOpen: @escaping @MainActor (URL) -> Void) {
        _model = StateObject(wrappedValue: InAppMessageModel(client: client))
        self.pollInterval = pollInterval
        self.onOpen = onOpen
    }

    private var modalBinding: Binding<InboxMessage?> {
        Binding(get: { model.current?.layout == .modal ? model.current : nil }, set: { if $0 == nil { model.dismiss() } })
    }
    private var fullBinding: Binding<InboxMessage?> {
        Binding(get: { model.current?.layout == .fullscreen ? model.current : nil }, set: { if $0 == nil { model.dismiss() } })
    }

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let m = model.current, m.layout == .banner {
                    InAppCard(message: m, compact: true, onTap: { model.tap($0, onOpen: onOpen) }, onClose: { model.dismiss() })
                        .padding(.horizontal, 12)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .zIndex(1)
                }
            }
            .animation(.spring(response: 0.35, dampingFraction: 0.85), value: model.current)
            .sheet(item: modalBinding) { m in
                InAppCard(message: m, compact: false, onTap: { model.tap($0, onOpen: onOpen) }, onClose: { model.dismiss() })
                    .padding()
            }
            .fullScreenCover(item: fullBinding) { m in
                InAppCard(message: m, compact: false, onTap: { model.tap($0, onOpen: onOpen) }, onClose: { model.dismiss() })
            }
            .task {
                while !Task.isCancelled {
                    await model.refresh()
                    try? await Task.sleep(nanoseconds: UInt64(max(15, pollInterval) * 1_000_000_000))
                }
            }
            .onChange(of: scenePhase) { phase in
                if phase == .active { Task { await model.refresh() } }
            }
    }
}

@available(iOS 15.0, *)
struct InAppCard: View {
    let message: InboxMessage
    let compact: Bool
    let onTap: (String?) -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let image = message.imageUrl.flatMap(URL.init(string:)) {
                AsyncImage(url: image) { $0.resizable().scaledToFill() } placeholder: { Color.secondary.opacity(0.1) }
                    .frame(maxWidth: .infinity, maxHeight: compact ? 0 : 200)
                    .clipped()
                    .opacity(compact ? 0 : 1)
            }
            HStack(alignment: .top) {
                Text(message.title).font(compact ? .subheadline.bold() : .title3.bold())
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button(action: onClose) { Image(systemName: "xmark").foregroundStyle(.secondary) }
                    .accessibilityLabel("Dismiss")
            }
            if !message.body.isEmpty {
                Text(message.body).font(compact ? .footnote : .body).foregroundStyle(.secondary)
            }
            if !message.buttons.isEmpty {
                HStack(spacing: 8) {
                    ForEach(Array(message.buttons.enumerated()), id: \.offset) { i, b in
                        if i == 0 {
                            Button(b.label) { onTap(b.url) }.buttonStyle(.borderedProminent)
                        } else {
                            Button(b.label) { onTap(b.url) }.buttonStyle(.bordered)
                        }
                    }
                }
            }
        }
        .padding(compact ? 12 : 20)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(.systemBackground)).shadow(radius: compact ? 6 : 0))
        .contentShape(Rectangle())
        .onTapGesture { if message.url != nil { onTap(nil) } }
        .accessibilityElement(children: .contain)
    }
}
#endif
