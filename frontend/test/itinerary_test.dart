import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:travelly/core/api/api_client.dart';
import 'package:travelly/features/itinerary/data/itinerary_service.dart';
import 'package:travelly/features/itinerary/presentation/itinerary_screen.dart';

Map<String, dynamic> savedPlan() => {
  'version': 1,
  'generatedAt': '2026-10-07T00:00:00.000Z',
  'stale': false,
  'preferences': {'budget': 1000, 'interests': 'Beaches'},
  'itinerary': {
    'destination': 'Goa',
    'currency': 'INR',
    'summary': 'A relaxed day in Goa',
    'estimatedTotalCost': 200,
    'days': [
      {
        'day': 1,
        'date': '2026-12-10',
        'activities': [
          {
            'time': '09:00',
            'title': 'Beach walk',
            'description': 'Enjoy the coast.',
            'estimatedCost': 200,
          },
        ],
      },
    ],
  },
};

Widget screen(ItineraryService service) => MaterialApp(
  home: ItineraryScreen(
    tripId: 'trip-id',
    destination: 'Goa',
    dateRange: '2026-12-10 – 2026-12-10',
    currency: 'INR',
    service: service,
  ),
);
ItineraryService serviceFor(
  Future<http.Response> Function(http.Request) handler,
) {
  final client = ApiClient(
    baseUrl: 'http://localhost:5001/api',
    client: MockClient(handler),
  );
  client.setAuthToken('fixture-token');
  return ItineraryService(client);
}

http.Response ok(dynamic data) =>
    http.Response(jsonEncode({'success': true, 'data': data}), 200);

void main() {
  testWidgets(
    'generation uses authenticated API client and displays structured days',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final pending = Completer<http.Response>();
      Map<String, dynamic>? sent;
      final service = serviceFor((request) async {
        expect(request.headers['Authorization'], 'Bearer fixture-token');
        if (request.method == 'GET') return ok(null);
        expect(request.url.path, '/api/groups/trip-id/generate-itinerary');
        sent = jsonDecode(request.body) as Map<String, dynamic>;
        return pending.future;
      });
      await tester.pumpWidget(screen(service));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).first, '1000');
      await tester.enterText(find.byType(TextFormField).last, 'Beaches');
      await tester.tap(find.text('Generate AI Itinerary'));
      await tester.pump();
      expect(find.text('Generating itinerary...'), findsOneWidget);
      expect(sent, {'budget': 1000.0, 'interests': 'Beaches'});
      pending.complete(ok(savedPlan()));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Day 1 · 2026-12-10'),
        250,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('09:00 · Beach walk'), findsOneWidget);
      expect(find.text('INR 200.00 for the group'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('missing key error is visible and retry succeeds', (
    tester,
  ) async {
    int calls = 0;
    final service = serviceFor((request) async {
      if (request.method == 'GET') return ok(null);
      if (++calls == 1) {
        return http.Response(
          jsonEncode({'error': 'AI itinerary generation is not configured.'}),
          503,
        );
      }
      return ok(savedPlan());
    });
    await tester.pumpWidget(screen(service));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Generate AI Itinerary'));
    await tester.pumpAndSettle();
    expect(
      find.text('AI itinerary generation is not configured.'),
      findsOneWidget,
    );
    await tester.ensureVisible(find.text('Retry'));
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(calls, 2);
    expect(find.text('Regenerate AI Itinerary'), findsOneWidget);
  });

  testWidgets(
    'saved plan reloads, restores preferences and shows stale warning',
    (tester) async {
      final service = serviceFor(
        (request) async => ok({...savedPlan(), 'stale': true}),
      );
      await tester.pumpWidget(screen(service));
      await tester.pumpAndSettle();
      expect(find.text('1000'), findsOneWidget);
      expect(find.text('Beaches'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.textContaining('Your trip details have changed.'),
        250,
        scrollable: find.byType(Scrollable).first,
      );
      expect(
        find.textContaining('Your trip details have changed.'),
        findsOneWidget,
      );
    },
  );

  testWidgets('invalid budget prevents generation', (tester) async {
    int posts = 0;
    final service = serviceFor((request) async {
      if (request.method == 'POST') posts++;
      return ok(null);
    });
    await tester.pumpWidget(screen(service));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, '-1');
    await tester.tap(find.text('Generate AI Itinerary'));
    await tester.pumpAndSettle();
    expect(posts, 0);
    expect(find.textContaining('Enter an amount'), findsOneWidget);
  });
}
