import 'dart:async';
import '../../../core/api/api_client.dart';
import '../../../core/api/api_endpoints.dart';

class ItineraryActivity {
  final String time, title, description;
  final num estimatedCost;
  ItineraryActivity.fromJson(Map<String, dynamic> json)
    : time = json['time'] as String,
      title = json['title'] as String,
      description = json['description'] as String,
      estimatedCost = json['estimatedCost'] as num;
}

class ItineraryDay {
  final int day;
  final String date;
  final List<ItineraryActivity> activities;
  ItineraryDay.fromJson(Map<String, dynamic> json)
    : day = json['day'] as int,
      date = json['date'] as String,
      activities = (json['activities'] as List)
          .map(
            (item) => ItineraryActivity.fromJson(item as Map<String, dynamic>),
          )
          .toList();
}

class SavedItinerary {
  final String summary, destination, currency, generatedAt, interests;
  final num estimatedTotalCost;
  final num? budget;
  final bool stale;
  final List<ItineraryDay> days;

  SavedItinerary.fromJson(Map<String, dynamic> json)
    : summary = json['itinerary']['summary'] as String,
      destination = json['itinerary']['destination'] as String,
      currency = json['itinerary']['currency'] as String,
      generatedAt = json['generatedAt'] as String,
      interests = json['preferences']['interests'] as String,
      budget = json['preferences']['budget'] as num?,
      estimatedTotalCost = json['itinerary']['estimatedTotalCost'] as num,
      stale = json['stale'] == true,
      days = (json['itinerary']['days'] as List)
          .map((item) => ItineraryDay.fromJson(item as Map<String, dynamic>))
          .toList();
}

class ItineraryService {
  final ApiClient apiClient;
  ItineraryService(this.apiClient);

  Future<SavedItinerary?> load(String tripId) async {
    final response = await apiClient
        .get(ApiEndpoints.itinerary(tripId))
        .timeout(const Duration(seconds: 20));
    final data = response['data'];
    return data == null ? null : SavedItinerary.fromJson(data);
  }

  Future<SavedItinerary> generate(
    String tripId, {
    double? budget,
    String interests = '',
  }) async {
    final response = await apiClient
        .post(
          ApiEndpoints.generateItinerary(tripId),
          body: {'budget': budget, 'interests': interests},
        )
        .timeout(const Duration(seconds: 60));
    return SavedItinerary.fromJson(response['data']);
  }
}
