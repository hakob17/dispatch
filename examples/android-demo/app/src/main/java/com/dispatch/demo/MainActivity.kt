package com.dispatch.demo

import android.Manifest
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.util.LruCache
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dispatch.sdk.ContentCard
import com.dispatch.sdk.Dispatch
import com.dispatch.sdk.InboxMessage
import com.dispatch.sdk.PreferenceGroup
import com.dispatch.sdk.Recommendation
import com.dispatch.sdk.RecommendationStrategy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

private val Accent = Color(0xFFD6452B)

class MainActivity : ComponentActivity() {
    private val askPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) DemoState.registerDemoToken() else DemoState.pushStatus.value = "Permission denied"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handle(intent)
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Accent, secondary = Accent)) {
                DemoRoot(onEnablePush = ::enablePush)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** Notification taps (reported once by the SDK) and plain deep links. */
    private fun handle(intent: Intent?) {
        Dispatch.handleNotificationOpen(intent)?.let { push ->
            DemoState.log("Opened push “${push.title ?: push.messageId}”")
            DemoState.open(push.url)
            return
        }
        intent?.data?.toString()?.let(DemoState::open)
    }

    private fun enablePush() {
        if (Build.VERSION.SDK_INT >= 33) askPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        else DemoState.registerDemoToken()
    }
}

// ------------------------------------------------------------------ shell

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DemoRoot(onEnablePush: () -> Unit) {
    var tab by remember { mutableIntStateOf(0) }
    val unread by DemoState.unread.collectAsStateWithLifecycle()
    val article by DemoState.openArticle.collectAsStateWithLifecycle()
    val titles = listOf("Dispatch News", "Message centre", "Alerts", "Profile")

    Scaffold(
        topBar = { TopAppBar(title = { Text(titles[tab], fontWeight = FontWeight.Bold) }) },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(tab == 0, { tab = 0 }, { Icon(Icons.Filled.Home, null) }, label = { Text("For you") })
                NavigationBarItem(tab == 1, { tab = 1 }, {
                    BadgedBox(badge = { if (unread > 0) Badge { Text("$unread") } }) { Icon(Icons.Filled.Email, null) }
                }, label = { Text("Inbox") })
                NavigationBarItem(tab == 2, { tab = 2 }, { Icon(Icons.Filled.Notifications, null) }, label = { Text("Alerts") })
                NavigationBarItem(tab == 3, { tab = 3 }, { Icon(Icons.Filled.Person, null) }, label = { Text("Profile") })
            }
        },
    ) { inner ->
        Box(Modifier.padding(inner).fillMaxSize()) {
            when (tab) {
                0 -> ForYouScreen(refreshKey = article)
                1 -> InboxScreen()
                2 -> AlertsScreen(onEnablePush)
                else -> ProfileScreen()
            }
        }
    }
    InAppMessages()
    article?.let { id ->
        ModalBottomSheet(onDismissRequest = { DemoState.openArticle.value = null }) { ArticleScreen(id) }
    }
}

// --------------------------------------------------------------- For you

@Composable
private fun ForYouScreen(refreshKey: String?) {
    var strategy by remember { mutableStateOf(RecommendationStrategy.FOR_YOU) }
    val items by produceState<List<Recommendation>?>(null, strategy, refreshKey) {
        value = runCatching { Dispatch.client.recommendations(strategy, limit = 10) }
            .onFailure { DemoState.log("⚠︎ recommendations: ${it.message}") }
            .getOrDefault(emptyList())
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(RecommendationStrategy.FOR_YOU to "For you", RecommendationStrategy.TRENDING to "Trending", RecommendationStrategy.LATEST to "Latest")
                .forEach { (s, label) -> FilterChip(selected = strategy == s, onClick = { strategy = s }, label = { Text(label) }) }
        }
        LazyColumn(Modifier.fillMaxSize()) {
            item { CardsSection(refreshKey) }
            if (items?.isEmpty() == true) item { Hint("Nothing new — publish a story with npm run demo -- breaking \"…\"") }
            items(items ?: emptyList(), key = { it.id }) { item ->
                Row(
                    Modifier.fillMaxWidth().clickable { DemoState.openArticle.value = item.id }.padding(16.dp, 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    RemoteImage(item.imageUrl, Modifier.width(92.dp).height(68.dp).clip(RoundedCornerShape(8.dp)))
                    Column(Modifier.weight(1f)) {
                        Text((item.section ?: "news").uppercase(), color = Accent, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        Text(item.title, fontWeight = FontWeight.SemiBold, maxLines = 3)
                        item.score?.let { Text("score %.3f".format(it), fontSize = 11.sp, color = Color.Gray) }
                    }
                }
                HorizontalDivider(Modifier.padding(start = 120.dp))
            }
        }
    }
}

/** Content-card feed: pinned first; impressions logged as cards compose; ✕ dismisses. */
@Composable
private fun CardsSection(refreshKey: String?) {
    val scope = rememberCoroutineScope()
    var cards by remember { mutableStateOf<List<ContentCard>>(emptyList()) }
    LaunchedEffect(refreshKey) {
        cards = runCatching { Dispatch.client.contentCards().cards }.onFailure { DemoState.log("⚠︎ cards: ${it.message}") }.getOrDefault(emptyList())
    }
    Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        cards.forEach { card ->
            LaunchedEffect(card.id) { Dispatch.client.logCardsViewed(listOf(card.id)) }
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0x0F000000))
                    .clickable(onClickLabel = card.buttonLabel ?: "Open") {
                        scope.launch { Dispatch.client.logCardClicked(card.id, card.url) }
                        DemoState.log("Tapped card “${card.title}”")
                        DemoState.open(card.url)
                    }
            ) {
                Column {
                    if (card.style != "CLASSIC" && card.imageUrl != null) {
                        RemoteImage(card.imageUrl, Modifier.fillMaxWidth().height(if (card.style == "BANNER") 110.dp else 150.dp))
                    }
                    if (card.style != "BANNER") {
                        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (card.style == "CLASSIC" && card.imageUrl != null) RemoteImage(card.imageUrl, Modifier.size(56.dp).clip(RoundedCornerShape(6.dp)))
                            Column(Modifier.weight(1f).padding(end = if (card.dismissible || card.pinned) 28.dp else 0.dp)) {
                                Text(card.title, fontWeight = FontWeight.SemiBold)
                                if (card.body.isNotEmpty()) Text(card.body, fontSize = 13.sp, color = Color.Gray, maxLines = 3)
                                card.buttonLabel?.let { Text("$it →", color = Accent, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp)) }
                            }
                        }
                    }
                }
                Row(Modifier.align(Alignment.TopEnd).padding(4.dp)) {
                    if (card.pinned) Text("📌", modifier = Modifier.padding(8.dp))
                    if (card.dismissible) {
                        TextButton(onClick = {
                            cards = cards.filter { it.id != card.id }
                            scope.launch { runCatching { Dispatch.client.dismissCards(listOf(card.id)) }; DemoState.log("Dismissed card “${card.title}”") }
                        }) { Text("✕", color = Color.DarkGray) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ArticleScreen(id: String) {
    LaunchedEffect(id) {
        Dispatch.client.articleRead(id)
        DemoState.log("Read article $id")
    }
    Column(Modifier.padding(20.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        RemoteImage("https://picsum.photos/seed/$id/800/450", Modifier.fillMaxWidth().height(200.dp).clip(RoundedCornerShape(12.dp)))
        Text("Article $id", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(
            "This screen stands in for your article page. Opening it sent an article_read event, so this story won't be " +
                "recommended again and its section now weighs more in your For you feed.",
            color = Color.Gray,
        )
    }
}

// ----------------------------------------------------------------- Inbox

@Composable
private fun InboxScreen() {
    val scope = rememberCoroutineScope()
    var messages by remember { mutableStateOf<List<InboxMessage>>(emptyList()) }
    suspend fun load() {
        runCatching { Dispatch.client.inbox(20) }.onSuccess { messages = it.messages; DemoState.unread.value = it.unread }
    }
    LaunchedEffect(Unit) { while (true) { load(); delay(15_000) } }
    LazyColumn(Modifier.fillMaxSize()) {
        if (messages.isEmpty()) item { Hint("No messages — try npm run demo -- inapp") }
        items(messages, key = { it.id }) { m ->
            Row(
                Modifier.fillMaxWidth().clickable {
                    scope.launch {
                        Dispatch.client.markRead(listOf(m.id))
                        DemoState.log("Read inbox message “${m.title}”")
                        m.url?.let { Dispatch.client.reportClicked(m.id, it); DemoState.open(it) }
                        load()
                    }
                }.padding(16.dp, 12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Box(Modifier.padding(top = 6.dp).size(8.dp).clip(CircleShape).background(if (m.read) Color.Transparent else Accent))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(m.title, fontWeight = if (m.read) FontWeight.Normal else FontWeight.SemiBold)
                    Text(m.body, color = Color.Gray, fontSize = 13.sp, maxLines = 2)
                }
                TextButton(onClick = { scope.launch { Dispatch.client.deleteMessages(listOf(m.id)); load() } }) { Text("Delete") }
            }
            HorizontalDivider()
        }
    }
}

/** Pop-up for in-app messages (MODAL / FULLSCREEN / BANNER) — polls like the iOS demo. */
@Composable
private fun InAppMessages() {
    val scope = rememberCoroutineScope()
    var current by remember { mutableStateOf<InboxMessage?>(null) }
    val externalId by DemoState.externalId.collectAsStateWithLifecycle()
    LaunchedEffect(externalId) {
        while (true) {
            if (current == null) {
                runCatching { Dispatch.client.inbox(20) }.getOrNull()?.messages
                    ?.firstOrNull { it.display && it.layout != "INBOX" }
                    ?.let { m -> current = m; Dispatch.client.reportDisplayed(m.id); DemoState.log("In-app message shown: “${m.title}”") }
            }
            delay(20_000)
        }
    }
    val m = current ?: return
    fun act(url: String?) = scope.launch {
        if (!url.isNullOrEmpty()) { Dispatch.client.reportClicked(m.id, url); DemoState.open(url) }
        Dispatch.client.markRead(listOf(m.id))
        current = null
    }
    AlertDialog(
        onDismissRequest = { act(null) },
        title = { Text(m.title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (!m.imageUrl.isNullOrEmpty()) RemoteImage(m.imageUrl, Modifier.fillMaxWidth().height(140.dp).clip(RoundedCornerShape(8.dp)))
                Text(m.body)
            }
        },
        confirmButton = {
            val primary = m.buttons.firstOrNull()
            Button(onClick = { act(primary?.url ?: m.url) }) { Text(primary?.label ?: "Open") }
        },
        dismissButton = { m.buttons.getOrNull(1)?.let { b -> OutlinedButton(onClick = { act(b.url) }) { Text(b.label) } } },
    )
}

// ---------------------------------------------------------------- Alerts

@Composable
private fun AlertsScreen(onEnablePush: () -> Unit) {
    val scope = rememberCoroutineScope()
    val status by DemoState.pushStatus.collectAsStateWithLifecycle()
    val externalId by DemoState.externalId.collectAsStateWithLifecycle()
    var groups by remember { mutableStateOf<List<PreferenceGroup>>(emptyList()) }
    LaunchedEffect(externalId) { groups = runCatching { Dispatch.client.preferences() }.getOrDefault(emptyList()) }

    fun set(g: PreferenceGroup, on: Boolean) = scope.launch {
        runCatching { Dispatch.client.setPreferences(mapOf(g.id to on)) }.onSuccess {
            groups = it
            DemoState.log("${if (on) "Subscribed to" else "Unsubscribed from"} ${g.name}")
        }
    }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        item {
            Section("Push notifications")
            Text("Status: $status")
            Button(onClick = onEnablePush, modifier = Modifier.padding(vertical = 8.dp)) { Text("Enable notifications") }
            Section("Newsletters")
            Hint("Configured in the Dispatch console. A newsletter only reaches people who subscribe — this app signs you up to Sport Wrap and Tech Weekly.")
        }
        items(groups.filter { it.isNewsletter }, key = { it.id }) { g -> GroupRow(g) { set(g, it) } }
        item {
            Section("Topics")
            Hint("On for everyone until you turn them off.")
        }
        items(groups.filter { !it.isNewsletter }, key = { it.id }) { g -> GroupRow(g) { set(g, it) } }
        item {
            Section("Live Update")
            OutlinedButton(onClick = { DemoState.followElection() }) { Text("Follow election night") }
            Hint("Registers this device for the election-2026 activity; `npm run demo -- live update` then drives an ongoing progress notification (a Live Update on Android 16).")
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun GroupRow(g: PreferenceGroup, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(g.name)
            g.description?.let { Text(it, fontSize = 12.sp, color = Color.Gray) }
        }
        Switch(checked = g.subscribed, onCheckedChange = onChange)
    }
}

// --------------------------------------------------------------- Profile

@Composable
private fun ProfileScreen() {
    val externalId by DemoState.externalId.collectAsStateWithLifecycle()
    val anonymousId by DemoState.anonymousId.collectAsStateWithLifecycle()
    val activity by DemoState.activity.collectAsStateWithLifecycle()
    var userId by remember { mutableStateOf("demo-reader-android") }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        item {
            Section("Identity")
            Text("Anonymous id: ${anonymousId.take(13)}…")
            Text("Signed in as: ${externalId ?: "—"}")
            if (externalId == null) {
                OutlinedTextField(userId, { userId = it }, label = { Text("User id") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Button(onClick = { DemoState.signIn(userId) }, modifier = Modifier.padding(vertical = 8.dp)) { Text("Sign in") }
            } else {
                OutlinedButton(onClick = { DemoState.signOut() }, modifier = Modifier.padding(vertical = 8.dp)) { Text("Sign out") }
            }
            Section("Server")
            Text(BuildConfig.DISPATCH_BASE_URL)
            Text("SDK key: ${BuildConfig.DISPATCH_SDK_KEY.take(14).ifEmpty { "missing" }}…")
            Section("What the SDK did")
        }
        items(activity) { Text(it, fontFamily = FontFamily.Monospace, fontSize = 11.sp, modifier = Modifier.padding(vertical = 2.dp)) }
    }
}

// ---------------------------------------------------------------- pieces

@Composable
private fun Section(title: String) =
    Text(title, style = MaterialTheme.typography.titleSmall, color = Accent, modifier = Modifier.padding(top = 18.dp, bottom = 6.dp))

@Composable
private fun Hint(text: String) = Text(text, fontSize = 12.sp, color = Color.Gray, modifier = Modifier.padding(vertical = 6.dp))

private val images = LruCache<String, Bitmap>(40)

/** Tiny image loader (the demo avoids extra dependencies). */
@Composable
private fun RemoteImage(url: String?, modifier: Modifier) {
    val bmp by produceState(url?.let { images.get(it) }, url) {
        if (url.isNullOrEmpty() || value != null) return@produceState
        value = withContext(Dispatchers.IO) {
            runCatching {
                val c = URL(url).openConnection() as HttpURLConnection
                c.connectTimeout = 8_000; c.readTimeout = 8_000; c.instanceFollowRedirects = true
                c.inputStream.use { BitmapFactory.decodeStream(it) }
            }.getOrNull()
        }?.also { images.put(url, it) }
    }
    val b = bmp
    if (b != null) Image(b.asImageBitmap(), null, modifier, contentScale = ContentScale.Crop)
    else Box(modifier.background(Color(0x14000000)))
}
