import ActivityKit
import SwiftUI
import WidgetKit

@main
struct DispatchDemoWidgets: WidgetBundle {
    var body: some Widget { ElectionLiveActivity() }
}

struct ElectionLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ElectionAttributes.self) { context in
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label(context.attributes.race, systemImage: "checkmark.seal").font(.headline)
                    Spacer()
                    Text("LIVE").font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.red, in: Capsule()).foregroundStyle(.white)
                }
                Text(context.state.subtitle).font(.subheadline)
                ProgressView(value: context.state.progress).tint(.red)
                Text("Leading: \(context.state.leader)").font(.caption).foregroundStyle(.secondary)
            }
            .padding()
            .activityBackgroundTint(Color(.systemBackground))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Text(context.state.leader).font(.headline) }
                DynamicIslandExpandedRegion(.trailing) { Text("\(Int(context.state.progress * 100))%").font(.headline) }
                DynamicIslandExpandedRegion(.bottom) { ProgressView(value: context.state.progress).tint(.red) }
            } compactLeading: {
                Image(systemName: "checkmark.seal").foregroundStyle(.red)
            } compactTrailing: {
                Text("\(Int(context.state.progress * 100))%")
            } minimal: {
                Image(systemName: "checkmark.seal")
            }
        }
    }
}
