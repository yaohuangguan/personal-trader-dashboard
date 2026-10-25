import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'api.dart';

const firebaseProject = String.fromEnvironment('FIREBASE_PROJECT_ID');
const firebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');
const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
const firebaseSender = String.fromEnvironment('FIREBASE_SENDER_ID');
bool get nativePushConfigured =>
    !kIsWeb &&
    firebaseProject.isNotEmpty &&
    firebaseAppId.isNotEmpty &&
    firebaseApiKey.isNotEmpty &&
    firebaseSender.isNotEmpty;
FirebaseOptions get firebaseOptions => const FirebaseOptions(
  apiKey: firebaseApiKey,
  appId: firebaseAppId,
  messagingSenderId: firebaseSender,
  projectId: firebaseProject,
  iosBundleId: 'space.ps6.marketAtlas',
);
@pragma('vm:entry-point')
Future<void> backgroundSignal(RemoteMessage message) async {
  if (nativePushConfigured) {
    await Firebase.initializeApp(options: firebaseOptions);
  }
}

class NativePushService {
  NativePushService(this.api, this.deviceToken);
  final AtlasApi api;
  final String deviceToken;
  final notifications = FlutterLocalNotificationsPlugin();
  final StreamController<String> opened = StreamController.broadcast();
  final List<StreamSubscription<dynamic>> subscriptions = [];
  bool ready = false;
  String? error, initialUrl;
  Future<void> initialize() async {
    if (!nativePushConfigured) return;
    try {
      await Firebase.initializeApp(options: firebaseOptions);
      FirebaseMessaging.onBackgroundMessage(backgroundSignal);
      await notifications.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(
            requestAlertPermission: false,
            requestBadgePermission: false,
            requestSoundPermission: false,
          ),
        ),
        onDidReceiveNotificationResponse: (response) {
          if (response.payload != null) opened.add(response.payload!);
        },
      );
      await notifications
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >()
          ?.createNotificationChannel(
            const AndroidNotificationChannel(
              'market_signals',
              'Market signals',
              description: 'Five MA intraday candidates and confirmations',
              importance: Importance.high,
            ),
          );
      subscriptions.add(
        FirebaseMessaging.onMessage.listen((message) {
          final n = message.notification;
          if (n != null) {
            notifications.show(
              id: message.messageId.hashCode,
              title: n.title,
              body: n.body,
              notificationDetails: const NotificationDetails(
                android: AndroidNotificationDetails(
                  'market_signals',
                  'Market signals',
                  importance: Importance.high,
                  priority: Priority.high,
                ),
                iOS: DarwinNotificationDetails(
                  presentAlert: true,
                  presentSound: true,
                ),
              ),
              payload: str(message.data['url'], '/?view=signals'),
            );
          }
        }),
      );
      subscriptions.add(
        FirebaseMessaging.onMessageOpenedApp.listen(
          (message) => opened.add(str(message.data['url'], '/?view=signals')),
        ),
      );
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      initialUrl = initial == null
          ? null
          : str(initial.data['url'], '/?view=signals');
      ready = true;
    } catch (e) {
      error = e.toString();
    }
  }

  Future<void> enable() async {
    if (!ready) throw StateError('原生推送配置待接入 Firebase / APNs');
    final status = await api.get('/api/monitor/status', token: deviceToken);
    if (status['nativeAvailable'] != true) {
      throw StateError('Firebase 原生推送尚未配置');
    }
    final settings = await FirebaseMessaging.instance.requestPermission();
    if (settings.authorizationStatus != AuthorizationStatus.authorized &&
        settings.authorizationStatus != AuthorizationStatus.provisional) {
      throw StateError('通知未获允许，请在系统设置中开启。');
    }
    await FirebaseMessaging.instance.setAutoInitEnabled(true);
    // FCM HTTP v1 uses registration tokens; keep the compatibility token API.
    // ignore: deprecated_member_use
    final token = await FirebaseMessaging.instance.getToken();
    if (token == null) throw StateError('设备通知令牌尚未就绪');
    await _register(token);
    subscriptions.add(
      // ignore: deprecated_member_use
      FirebaseMessaging.instance.onTokenRefresh.listen((token) {
        _register(token).catchError((Object e) {
          error = e.toString();
        });
      }),
    );
  }

  Future<void> _register(String token) async {
    await api.post('/api/monitor/native-subscribe', {
      'token': token,
      'platform': defaultTargetPlatform.name,
    }, token: deviceToken);
  }

  Future<void> disable() async {
    await api.post('/api/monitor/native-unsubscribe', {}, token: deviceToken);
    if (ready) {
      // ignore: deprecated_member_use
      await FirebaseMessaging.instance.deleteToken();
      await FirebaseMessaging.instance.setAutoInitEnabled(false);
    }
  }

  Future<void> dispose() async {
    for (final sub in subscriptions) {
      await sub.cancel();
    }
    await opened.close();
  }
}
